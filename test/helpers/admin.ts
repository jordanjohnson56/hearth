// The admin session as the tests drive it: set the PIN the way the
// first-run form does, unlock, and use the token on bearer routes.
import type { Express } from 'express';
import request from 'supertest';

export const TEST_PIN = '1234';

/** Sets the PIN on a fresh app (no bearer needed for the first set). */
export async function setPin(app: Express, pin = TEST_PIN): Promise<void> {
  await request(app).put('/api/admin/pin').send({ pin });
}

/** Tries `pin`; the token when accepted, undefined when refused. */
export async function unlock(app: Express, pin = TEST_PIN): Promise<string> {
  const res = await request(app).post('/api/admin/unlock').send({ pin });
  return (res.body as { token: string }).token;
}

/** Sets the PIN and unlocks with it: the token for bearer routes. */
export async function setPinAndUnlock(app: Express, pin = TEST_PIN): Promise<string> {
  await setPin(app, pin);
  return unlock(app, pin);
}
