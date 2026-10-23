import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers/app.js';

async function unlock(app: Express, pin = '1234'): Promise<string> {
  const res = await request(app).post('/api/admin/unlock').send({ pin });
  return (res.body as { token: string }).token;
}

/** An app with PIN 1234 set and an unlocked admin session. */
async function unlockedApp(): Promise<{ app: Express; token: string }> {
  const app = testApp();
  await request(app).put('/api/admin/pin').send({ pin: '1234' });
  return { app, token: await unlock(app) };
}

describe('GET /api/settings/theme', () => {
  it('answers the defaults on a fresh database', async () => {
    const res = await request(testApp()).get('/api/settings/theme');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lightFrom: '07:00', darkFrom: '19:30' });
  });
});

describe('PUT /api/settings/theme', () => {
  it('stores both times and answers them; GET then returns them', async () => {
    const { app, token } = await unlockedApp();

    const put = await request(app)
      .put('/api/settings/theme')
      .set('Authorization', `Bearer ${token}`)
      .send({ lightFrom: '06:30', darkFrom: '21:00' });
    const get = await request(app).get('/api/settings/theme');

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ lightFrom: '06:30', darkFrom: '21:00' });
    expect(get.body).toEqual({ lightFrom: '06:30', darkFrom: '21:00' });
  });

  it('accepts the times in either order (a dark morning, a light evening)', async () => {
    const { app, token } = await unlockedApp();

    const res = await request(app)
      .put('/api/settings/theme')
      .set('Authorization', `Bearer ${token}`)
      .send({ lightFrom: '20:00', darkFrom: '06:00' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lightFrom: '20:00', darkFrom: '06:00' });
  });

  it('needs a bearer and leaves the settings alone without one', async () => {
    const { app } = await unlockedApp();

    const put = await request(app)
      .put('/api/settings/theme')
      .send({ lightFrom: '06:30', darkFrom: '21:00' });
    const get = await request(app).get('/api/settings/theme');

    expect(put.status).toBe(401);
    expect(get.body).toEqual({ lightFrom: '07:00', darkFrom: '19:30' });
  });

  it('refuses equal times with a message', async () => {
    const { app, token } = await unlockedApp();

    const res = await request(app)
      .put('/api/settings/theme')
      .set('Authorization', `Bearer ${token}`)
      .send({ lightFrom: '08:00', darkFrom: '08:00' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message: 'Light from and dark from must differ' });
  });

  it.each([
    ['a 12-hour time', { lightFrom: '7:00', darkFrom: '19:30' }, 'Light from'],
    ['an out-of-range hour', { lightFrom: '07:00', darkFrom: '24:00' }, 'Dark from'],
    ['a missing field', { lightFrom: '07:00' }, 'Dark from'],
    ['a number', { lightFrom: 700, darkFrom: '19:30' }, 'Light from'],
  ])('refuses %s with a message naming the field', async (_name, body, field) => {
    const { app, token } = await unlockedApp();

    const res = await request(app)
      .put('/api/settings/theme')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(field);
  });

  it('answers 400 for a non-object body', async () => {
    const { app, token } = await unlockedApp();

    const res = await request(app)
      .put('/api/settings/theme')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('"07:00"');

    expect(res.status).toBe(400);
  });
});
