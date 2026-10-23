import { accessSync, constants, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOG_LEVELS } from './logger.js';
import type { LogLevel } from './logger.js';

/** Bootstrap configuration: only what the process needs before it can start. */
export interface Config {
  port: number;
  /** Absolute path; exists and is writable once the loader has accepted it. */
  dataDir: string;
  /** IANA zone, e.g. `America/Chicago`. All local-date math uses it. */
  zone: string;
  logLevel: LogLevel;
}

export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; errors: string[] };

/** The process environment, or any stand-in for it. */
export type Env = Readonly<Record<string, string | undefined>>;

export interface LoadConfigOptions {
  /** Directory a relative DATA_DIR resolves against (the process's cwd). */
  cwd: string;
}

/** Defaults; these match .env.example. */
export const CONFIG_DEFAULTS = {
  PORT: '4400',
  DATA_DIR: './data',
  TZ: 'America/Chicago',
  LOG_LEVEL: 'info',
} as const;

/**
 * Validates the bootstrap environment and reports every problem at once.
 * Pure except for DATA_DIR, which it creates if missing and probes for
 * write access. It never reads `process.env`; the entrypoint passes it in.
 */
export function loadConfig(env: Env, options: LoadConfigOptions): ConfigResult {
  const errors: string[] = [];
  const read = (name: keyof typeof CONFIG_DEFAULTS): string => {
    const value = env[name];
    // Empty counts as missing, so `PORT=` in a .env file means "default".
    return value === undefined || value === '' ? CONFIG_DEFAULTS[name] : value;
  };

  const port = parsePort(read('PORT'));
  if (port === undefined) {
    errors.push(`PORT must be an integer from 1 to 65535 (got "${read('PORT')}").`);
  }

  const dataDir = resolve(options.cwd, read('DATA_DIR'));
  const dataDirProblem = checkWritableDirectory(dataDir);
  if (dataDirProblem !== undefined) {
    errors.push(`DATA_DIR must be a directory Hearth can create and write to: ${dataDir} ${dataDirProblem}.`);
  }

  const zone = read('TZ');
  if (!isIanaZone(zone)) {
    errors.push(`TZ must be a valid IANA time zone such as America/Chicago (got "${zone}").`);
  }

  const logLevel = parseLogLevel(read('LOG_LEVEL'));
  if (logLevel === undefined) {
    errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${read('LOG_LEVEL')}").`);
  }

  if (port === undefined || logLevel === undefined || errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, config: { port, dataDir, zone, logLevel } };
}

function parsePort(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function parseLogLevel(raw: string): LogLevel | undefined {
  return LOG_LEVELS.find((level) => level === raw);
}

function isIanaZone(zone: string): boolean {
  try {
    // Throws RangeError for an unknown zone. Offsets like "+05:00" are
    // accepted by Intl but are not IANA zones, and have no DST rules.
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    return false;
  }
  return !/^[+-]/.test(zone);
}

/** Returns why `dir` is unusable, or undefined when it is a writable directory. */
function checkWritableDirectory(dir: string): string | undefined {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    // EEXIST here means a non-directory already sits at that path.
    return `cannot be created (${codeOf(err)})`;
  }
  try {
    accessSync(dir, constants.W_OK);
  } catch (err) {
    return `is not writable (${codeOf(err)})`;
  }
  return undefined;
}

function codeOf(err: unknown): string {
  const code: unknown = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown error';
}
