// Hashing and checking of the admin PIN with scrypt from node:crypto.
//
// A 4-digit PIN has 10,000 values, so no hash protects it from someone who
// has the database file and a minute; the hash protects against a casual
// look at the file, nothing more (DESIGN.md section 3). The parameters are
// kept in the stored string so they can change without a migration.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** True when `pin` is exactly four ASCII digits, the only shape a PIN may have. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^[0-9]{4}$/.test(pin);
}

/** `scrypt$<N>$<r>$<p>$<salt>$<key>`, salt and key base64url, fresh salt each call. */
export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = derive(pin, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * True when `pin` is the one `stored` was made from. Constant time in the
 * key comparison; an unreadable stored value is simply never matched.
 */
export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, keyText] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((value) => Number.isInteger(value) && value > 0)) return false;
  const expected = Buffer.from(keyText ?? '', 'base64url');
  if (expected.length !== KEY_BYTES) return false;
  const actual = derive(pin, Buffer.from(saltText ?? '', 'base64url'), N, R, P);
  return timingSafeEqual(actual, expected);
}

function derive(pin: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(pin, salt, KEY_BYTES, { N, r, p, maxmem: 256 * N * r });
}
