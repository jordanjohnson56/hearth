// Core admin: the PIN, unlock tokens and the requireAdmin gate, mounted by
// the app factory at /api/admin and handed to features through the context.
//
// Contract (status codes):
//   GET  /status         200 { pinSet }
//   PUT  /pin            204; 400 bad shape; once set also 401 no bearer,
//                        403 wrong currentPin
//   POST /unlock         200 { token }; 400 bad shape; 401 wrong PIN or no
//                        PIN set; 429 locked out ("Try again in N s")
//   POST /lock           204; 401 no bearer
// Tokens live 10 minutes from their last use and 60 minutes from issue.
import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import { TOKEN_IDLE_MS, TOKEN_MAX_MS } from '../core/adminSession.js';
import { readSetting, writeSetting } from './db/settingRepository.js';
import { BareHttpError, HttpError, bodyOf, jsonBody } from './http.js';
import type { Logger } from './logger.js';
import { hashPin, isValidPin, verifyPin } from './pinHash.js';

/** The setting key holding the scrypt hash of the admin PIN. */
export const PIN_HASH_SETTING = 'admin.pin_hash';

export { TOKEN_IDLE_MS, TOKEN_MAX_MS } from '../core/adminSession.js';

/** Consecutive unlock failures before the endpoint starts refusing. */
export const LOCKOUT_AFTER_FAILURES = 5;
/** The first lockout; each further failure doubles it, up to the cap. */
export const LOCKOUT_BASE_MS = 30_000;
export const LOCKOUT_MAX_MS = 15 * 60_000;

interface TokenRecord {
  issuedAt: number;
  lastUsedAt: number;
}

export interface AdminOptions {
  db: Database;
  now: () => Date;
  logger: Logger;
}

export interface Admin {
  /** Mounted by the app factory at /api/admin. */
  router: Router;
  /** The bearer-token gate handed to features through the context. */
  requireAdmin: RequestHandler;
}

export function createAdmin(options: AdminOptions): Admin {
  const { db, now, logger } = options;
  /** Live unlock tokens. In memory on purpose: a restart locks everyone out. */
  const tokens = new Map<string, TokenRecord>();
  // Attempt limits are process-wide, not per client: one Hearth serves one
  // household, and a child at the wall is the threat, not a botnet.
  let failures = 0;
  let lockedUntil = 0;

  function lockoutError(at: number): HttpError {
    const seconds = Math.ceil((lockedUntil - at) / 1_000);
    return new HttpError(429, `Too many wrong PINs. Try again in ${seconds} s`);
  }

  /**
   * The live token a request carries, renewed by this use, or undefined
   * when it carries none or an expired one. An expired token is forgotten
   * here, so the map holds nothing older than the absolute lifetime.
   */
  function tokenOf(req: Request): string | undefined {
    const header = req.get('authorization');
    if (header === undefined) return undefined;
    const [scheme, token, ...rest] = header.trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'bearer' || token === undefined || rest.length > 0) return undefined;
    const record = tokens.get(token);
    if (record === undefined) return undefined;
    const at = now().getTime();
    if (at - record.lastUsedAt >= TOKEN_IDLE_MS || at - record.issuedAt >= TOKEN_MAX_MS) {
      tokens.delete(token);
      return undefined;
    }
    record.lastUsedAt = at;
    return token;
  }

  // A bare 401 (no message): there is nothing to tell a caller without a
  // live token except to unlock, which the client already knows.
  const requireAdmin: RequestHandler = (req, _res, next) => {
    if (tokenOf(req) === undefined) throw unauthorized();
    next();
  };

  const router = Router();
  router.use(jsonBody);

  router.get('/status', (_req, res) => {
    res.json({ pinSet: readSetting(db, PIN_HASH_SETTING) !== undefined });
  });

  // First set needs no bearer (there is no PIN to unlock with yet); every
  // later change needs a live session and the current PIN, so a walked-away
  // unlocked iPad is not enough to take the PIN over.
  router.put('/pin', (req, res) => {
    const { pin, currentPin } = bodyOf(req.body);
    const stored = readSetting(db, PIN_HASH_SETTING);
    if (stored !== undefined) {
      if (tokenOf(req) === undefined) throw unauthorized();
      if (!isValidPin(currentPin)) {
        throw new HttpError(400, 'Current PIN must be exactly four digits');
      }
      if (!verifyPin(currentPin, stored)) throw new HttpError(403, 'Current PIN is wrong');
    }
    if (!isValidPin(pin)) throw new HttpError(400, 'PIN must be exactly four digits');
    writeSetting(db, PIN_HASH_SETTING, hashPin(pin));
    res.status(204).end();
  });

  router.post('/unlock', (req, res) => {
    const { pin } = bodyOf(req.body);
    if (!isValidPin(pin)) throw new HttpError(400, 'PIN must be exactly four digits');
    const at = now().getTime();
    // A refused attempt is not a failure: the count only moves when a PIN
    // is actually tried, so hammering the pad during a lockout gains and
    // loses nothing.
    if (at < lockedUntil) throw lockoutError(at);
    const stored = readSetting(db, PIN_HASH_SETTING);
    if (stored === undefined) throw new HttpError(401, 'No PIN is set');
    if (!verifyPin(pin, stored)) {
      failures += 1;
      if (failures < LOCKOUT_AFTER_FAILURES) {
        logger.warn({ failures }, 'admin unlock refused: wrong PIN');
        throw new HttpError(401, 'Wrong PIN');
      }
      const lockoutMs = Math.min(
        LOCKOUT_BASE_MS * 2 ** (failures - LOCKOUT_AFTER_FAILURES),
        LOCKOUT_MAX_MS,
      );
      lockedUntil = at + lockoutMs;
      logger.warn({ failures, lockoutSeconds: lockoutMs / 1_000 }, 'admin unlock locked out');
      throw lockoutError(at);
    }
    failures = 0;
    lockedUntil = 0;
    const token = randomBytes(32).toString('base64url');
    tokens.set(token, { issuedAt: at, lastUsedAt: at });
    res.json({ token });
  });

  router.post('/lock', requireAdmin, (req, res) => {
    const token = tokenOf(req);
    if (token !== undefined) tokens.delete(token);
    res.status(204).end();
  });

  return { router, requireAdmin };
}

function unauthorized(): BareHttpError {
  return new BareHttpError(401, 'no live admin token');
}
