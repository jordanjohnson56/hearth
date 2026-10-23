import { Router } from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { FeatureContext, ServerFeature } from '../features/types.js';
import { testApp, testAppOptions } from '../../test/helpers/app.js';
import { captureLogger } from '../../test/helpers/logger.js';
import { PIN_HASH_SETTING } from './admin.js';
import { createApp } from './app.js';
import { readSetting } from './db/settingRepository.js';

/** A test feature with one route behind the context's requireAdmin. */
function choresWithLockedRoute(): ServerFeature {
  return {
    id: 'chores',
    name: 'Test chores',
    migrations: [],
    createRouter(ctx: FeatureContext) {
      const router = Router();
      router.get('/locked', ctx.requireAdmin, (_req, res) => {
        res.json({ secret: true });
      });
      return router;
    },
  };
}

/** A clock tests move by hand; the app sees it through `now`. */
function clock(start = '2026-10-23T12:00:00Z'): { now: () => Date; advance: (ms: number) => void } {
  let at = new Date(start).getTime();
  return {
    now: () => new Date(at),
    advance: (ms) => {
      at += ms;
    },
  };
}

const MINUTE = 60_000;

async function unlock(app: Express, pin = '1234'): Promise<string> {
  const res = await request(app).post('/api/admin/unlock').send({ pin });
  return (res.body as { token: string }).token;
}

/** An app with PIN 1234 set the way the first-run form sets it. */
async function appWithPin(overrides: Parameters<typeof testApp>[0] = {}): Promise<Express> {
  const app = testApp(overrides);
  await request(app).put('/api/admin/pin').send({ pin: '1234' });
  return app;
}

describe('GET /api/admin/status', () => {
  it('reports that no PIN is set on a fresh database', async () => {
    const res = await request(testApp()).get('/api/admin/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pinSet: false });
  });
});

describe('PUT /api/admin/pin', () => {
  it('accepts the first PIN without a bearer and then reports it set', async () => {
    const app = testApp();

    const put = await request(app).put('/api/admin/pin').send({ pin: '1234' });
    const status = await request(app).get('/api/admin/status');

    expect(put.status).toBe(204);
    expect(status.body).toEqual({ pinSet: true });
  });

  it.each(['123', '12345', '12a4', 'abcd', '', 1234])(
    'refuses a PIN that is not exactly four digits (%j) with a 400 and a message',
    async (pin) => {
      const res = await request(testApp()).put('/api/admin/pin').send({ pin });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Bad Request', message: 'PIN must be exactly four digits' });
    },
  );
});

describe('POST /api/admin/unlock', () => {
  it('returns a token for the right PIN', async () => {
    const res = await request(await appWithPin()).post('/api/admin/unlock').send({ pin: '1234' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{32,}$/) as string });
  });

  it('issues a different token each time', async () => {
    const app = await appWithPin();

    const first = await request(app).post('/api/admin/unlock').send({ pin: '1234' });
    const second = await request(app).post('/api/admin/unlock').send({ pin: '1234' });

    expect(first.body).not.toEqual(second.body);
  });

  it('refuses the wrong PIN with a 401 and a message', async () => {
    const res = await request(await appWithPin()).post('/api/admin/unlock').send({ pin: '0000' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', message: 'Wrong PIN' });
  });

  it('refuses to unlock while no PIN is set', async () => {
    const res = await request(testApp()).post('/api/admin/unlock').send({ pin: '1234' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', message: 'No PIN is set' });
  });

  it('refuses a malformed PIN with a 400 and does not try it', async () => {
    const res = await request(await appWithPin()).post('/api/admin/unlock').send({ pin: 1234 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message: 'PIN must be exactly four digits' });
  });
});

describe('requireAdmin on a feature route', () => {
  it('lets a request through with a token from unlock', async () => {
    const app = await appWithPin({ features: [choresWithLockedRoute()] });
    const token = await unlock(app);

    const res = await request(app).get('/api/chores/locked').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ secret: true });
  });

  it('refuses a request without a bearer with a bare 401', async () => {
    const app = await appWithPin({ features: [choresWithLockedRoute()] });
    await unlock(app);

    const res = await request(app).get('/api/chores/locked');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it.each(['Bearer nope', 'Basic MTIzNA==', 'Bearer', 'Bearer  '])(
    'refuses a bad authorization header (%j) with a bare 401',
    async (header) => {
      const app = await appWithPin({ features: [choresWithLockedRoute()] });
      await unlock(app);

      const res = await request(app).get('/api/chores/locked').set('Authorization', header);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    },
  );
});

describe('POST /api/admin/lock', () => {
  it('revokes the bearer it was called with', async () => {
    const app = await appWithPin({ features: [choresWithLockedRoute()] });
    const token = await unlock(app);
    const auth = `Bearer ${token}`;

    const lock = await request(app).post('/api/admin/lock').set('Authorization', auth);
    const after = await request(app).get('/api/chores/locked').set('Authorization', auth);

    expect(lock.status).toBe(204);
    expect(after.status).toBe(401);
  });

  it('leaves other sessions unlocked', async () => {
    const app = await appWithPin({ features: [choresWithLockedRoute()] });
    const first = await unlock(app);
    const second = await unlock(app);

    await request(app).post('/api/admin/lock').set('Authorization', `Bearer ${first}`);
    const res = await request(app).get('/api/chores/locked').set('Authorization', `Bearer ${second}`);

    expect(res.status).toBe(200);
  });

  it('needs a valid bearer itself', async () => {
    const res = await request(await appWithPin()).post('/api/admin/lock');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});

describe('token lifetime', () => {
  async function unlockedWithClock(): Promise<{
    app: Express;
    auth: string;
    advance: (ms: number) => void;
    locked: () => Promise<number>;
  }> {
    const { now, advance } = clock();
    const app = await appWithPin({ features: [choresWithLockedRoute()], now });
    const auth = `Bearer ${await unlock(app)}`;
    const locked = async () =>
      (await request(app).get('/api/chores/locked').set('Authorization', auth)).status;
    return { app, auth, advance, locked };
  }

  it('is still live just under 10 minutes after the last use', async () => {
    const { advance, locked } = await unlockedWithClock();

    advance(10 * MINUTE - 1);

    expect(await locked()).toBe(200);
  });

  it('expires 10 minutes after the last use', async () => {
    const { advance, locked } = await unlockedWithClock();

    advance(10 * MINUTE);

    expect(await locked()).toBe(401);
  });

  it('is renewed by each use on a feature route', async () => {
    const { advance, locked } = await unlockedWithClock();

    advance(9 * MINUTE);
    expect(await locked()).toBe(200);
    advance(9 * MINUTE);

    expect(await locked()).toBe(200);
  });

  it('expires 60 minutes after issue however recently it was used', async () => {
    const { advance, locked } = await unlockedWithClock();

    for (let i = 0; i < 6; i += 1) {
      advance(9 * MINUTE);
      expect(await locked()).toBe(200);
    }
    advance(6 * MINUTE); // 60 minutes since issue, 6 since the last use

    expect(await locked()).toBe(401);
  });

  it('is still live just under 60 minutes after issue when kept in use', async () => {
    const { advance, locked } = await unlockedWithClock();

    for (let i = 0; i < 6; i += 1) {
      advance(9 * MINUTE);
      expect(await locked()).toBe(200);
    }
    advance(6 * MINUTE - 1);

    expect(await locked()).toBe(200);
  });

  it('is not revived by lock after it expired', async () => {
    const { app, auth, advance } = await unlockedWithClock();

    advance(10 * MINUTE);
    const res = await request(app).post('/api/admin/lock').set('Authorization', auth);

    expect(res.status).toBe(401);
  });
});

describe('unlock attempt limits', () => {
  const SECOND = 1_000;

  async function fail(app: Express, pin = '0000'): Promise<request.Response> {
    return request(app).post('/api/admin/unlock').send({ pin });
  }

  async function failTimes(app: Express, times: number): Promise<request.Response | undefined> {
    let last: request.Response | undefined;
    for (let i = 0; i < times; i += 1) last = await fail(app);
    return last;
  }

  it('answers the first four wrong PINs with a plain 401', async () => {
    const app = await appWithPin();

    const fourth = await failTimes(app, 4);

    expect(fourth?.status).toBe(401);
    expect(fourth?.body).toEqual({ error: 'Unauthorized', message: 'Wrong PIN' });
  });

  it('locks for 30 s on the fifth consecutive failure', async () => {
    const app = await appWithPin();

    const fifth = await failTimes(app, 5);

    expect(fifth?.status).toBe(429);
    expect(fifth?.body).toEqual({
      error: 'Too Many Requests',
      message: 'Too many wrong PINs. Try again in 30 s',
    });
  });

  it('refuses even the right PIN during the lockout, with the seconds left', async () => {
    const { now, advance } = clock();
    const app = await appWithPin({ now });
    await failTimes(app, 5);

    advance(12 * SECOND);
    const res = await fail(app, '1234');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: 'Too Many Requests',
      message: 'Too many wrong PINs. Try again in 18 s',
    });
  });

  it('rounds the seconds left up, never showing 0 s', async () => {
    const { now, advance } = clock();
    const app = await appWithPin({ now });
    await failTimes(app, 5);

    advance(30 * SECOND - 1);
    const res = await fail(app, '1234');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ message: 'Too many wrong PINs. Try again in 1 s' });
  });

  it('accepts the right PIN once the lockout has passed and resets the counter', async () => {
    const { now, advance } = clock();
    const app = await appWithPin({ now });
    await failTimes(app, 5);
    advance(30 * SECOND);

    const ok = await fail(app, '1234');
    const fourthAfter = await failTimes(app, 4);

    expect(ok.status).toBe(200);
    expect(fourthAfter?.status).toBe(401);
  });

  it('does not count attempts refused during a lockout', async () => {
    const { now, advance } = clock();
    const app = await appWithPin({ now });
    await failTimes(app, 5);
    await failTimes(app, 3); // all 429, none counted
    advance(30 * SECOND);

    const sixth = await fail(app);

    expect(sixth.status).toBe(429);
    expect(sixth.body).toMatchObject({ message: 'Too many wrong PINs. Try again in 60 s' });
  });

  it('doubles the lockout per further failure: 30, 60, 120 s', async () => {
    const { now, advance } = clock();
    const app = await appWithPin({ now });

    const fifth = await failTimes(app, 5);
    advance(30 * SECOND);
    const sixth = await fail(app);
    advance(60 * SECOND);
    const seventh = await fail(app);

    expect(fifth?.body).toMatchObject({ message: 'Too many wrong PINs. Try again in 30 s' });
    expect(sixth.body).toMatchObject({ message: 'Too many wrong PINs. Try again in 60 s' });
    expect(seventh.body).toMatchObject({ message: 'Too many wrong PINs. Try again in 120 s' });
  });

  it('caps the lockout at 15 minutes', async () => {
    const { now, advance } = clock();
    const app = await appWithPin({ now });
    await failTimes(app, 5);
    // 30, 60, 120, 240, 480 s pass; the next doubling would be 960 s.
    for (const seconds of [30, 60, 120, 240, 480]) {
      advance(seconds * SECOND);
      await fail(app);
    }
    advance(900 * SECOND);

    const eleventh = await fail(app);

    expect(eleventh.body).toMatchObject({ message: 'Too many wrong PINs. Try again in 900 s' });
  });

  it('a success between failures resets the count', async () => {
    const app = await appWithPin();
    await failTimes(app, 4);
    await fail(app, '1234');

    const fifthOverall = await fail(app);

    expect(fifthOverall.status).toBe(401);
  });

  it('counts failures across the whole process, not per client', async () => {
    const app = await appWithPin();
    await failTimes(app, 4);

    const fromElsewhere = await request(app)
      .post('/api/admin/unlock')
      .set('X-Forwarded-For', '192.0.2.7')
      .send({ pin: '0000' });

    expect(fromElsewhere.status).toBe(429);
  });
});

describe('PUT /api/admin/pin once a PIN is set', () => {
  it('refuses without a bearer with a bare 401', async () => {
    const res = await request(await appWithPin())
      .put('/api/admin/pin')
      .send({ pin: '5678', currentPin: '1234' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('refuses a wrong current PIN with a 403 and a message', async () => {
    const app = await appWithPin();
    const token = await unlock(app);

    const res = await request(app)
      .put('/api/admin/pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '5678', currentPin: '0000' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', message: 'Current PIN is wrong' });
  });

  it.each([undefined, '123', 1234])(
    'refuses a missing or malformed current PIN (%j) with a 400',
    async (currentPin) => {
      const app = await appWithPin();
      const token = await unlock(app);

      const res = await request(app)
        .put('/api/admin/pin')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: '5678', currentPin });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Bad Request',
        message: 'Current PIN must be exactly four digits',
      });
    },
  );

  it('changes the PIN with a bearer and the current PIN; the session stays live', async () => {
    const app = await appWithPin({ features: [choresWithLockedRoute()] });
    const token = await unlock(app);
    const auth = `Bearer ${token}`;

    const change = await request(app)
      .put('/api/admin/pin')
      .set('Authorization', auth)
      .send({ pin: '5678', currentPin: '1234' });
    const oldPin = await request(app).post('/api/admin/unlock').send({ pin: '1234' });
    const newPin = await request(app).post('/api/admin/unlock').send({ pin: '5678' });
    const stillLive = await request(app).get('/api/chores/locked').set('Authorization', auth);

    expect(change.status).toBe(204);
    expect(oldPin.status).toBe(401);
    expect(newPin.status).toBe(200);
    expect(stillLive.status).toBe(200);
  });

  it('still validates the new PIN', async () => {
    const app = await appWithPin();
    const token = await unlock(app);

    const res = await request(app)
      .put('/api/admin/pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '56789', currentPin: '1234' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message: 'PIN must be exactly four digits' });
  });
});

describe('what admin never reveals', () => {
  it('keeps the PIN hash, the PIN and the token out of every response and log line', async () => {
    const { logger, text } = captureLogger('trace');
    const options = testAppOptions({ features: [choresWithLockedRoute()], logger });
    const app = createApp(options).app;
    const responses: string[] = [];
    const call = async (req: request.Test): Promise<request.Response> => {
      const res = await req;
      responses.push(res.text);
      return res;
    };

    await call(request(app).put('/api/admin/pin').send({ pin: '1234' }));
    await call(request(app).get('/api/admin/status'));
    for (let i = 0; i < 6; i += 1) await call(request(app).post('/api/admin/unlock').send({ pin: '0000' }));
    // The lockout must pass for the right PIN; a fresh app has no clock to move, so a new one.
    const fresh = createApp(testAppOptions({ features: [choresWithLockedRoute()], logger })).app;
    await call(request(fresh).put('/api/admin/pin').send({ pin: '1234' }));
    const unlocked = await call(request(fresh).post('/api/admin/unlock').send({ pin: '1234' }));
    const { token } = unlocked.body as { token: string };
    await call(request(fresh).get('/api/chores/locked').set('Authorization', `Bearer ${token}`));
    await call(
      request(fresh)
        .put('/api/admin/pin')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: '5678', currentPin: '1234' }),
    );
    await call(request(fresh).post('/api/admin/lock').set('Authorization', `Bearer ${token}`));

    const hash = readSetting(options.db, PIN_HASH_SETTING);
    expect(hash).toMatch(/^scrypt\$/);
    const everything = responses.join('\n');
    expect(everything).not.toContain(hash);
    expect(everything).not.toContain('scrypt');
    expect(text()).not.toContain('scrypt');
    expect(text()).not.toContain(hash);
    expect(text()).not.toContain('1234');
    expect(text()).not.toContain('5678');
    expect(text()).not.toContain('0000');
    expect(text()).not.toContain(token);
  });

  it('logs each failure and the lockout at warn, by count only', async () => {
    const { logger, lines } = captureLogger();
    const app = await appWithPin({ logger });
    for (let i = 0; i < 5; i += 1) await request(app).post('/api/admin/unlock').send({ pin: '0000' });

    const warnings = lines().filter((line) => line.level === 40);

    expect(warnings).toHaveLength(5);
    expect(warnings[0]).toMatchObject({ failures: 1, msg: 'admin unlock refused: wrong PIN' });
    expect(warnings[4]).toMatchObject({
      failures: 5,
      lockoutSeconds: 30,
      msg: 'admin unlock locked out',
    });
    expect(Object.keys(warnings[4] ?? {}).sort()).toEqual(
      ['failures', 'level', 'lockoutSeconds', 'msg', 'time'],
    );
  });
});
