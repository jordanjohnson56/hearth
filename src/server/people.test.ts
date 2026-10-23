import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setPinAndUnlock } from '../../test/helpers/admin.js';
import { testAppOptions } from '../../test/helpers/app.js';
import { captureLogger } from '../../test/helpers/logger.js';
import type { FeatureId } from '../features/types.js';
import { createApp } from './app.js';
import { createBroadcaster } from './broadcaster.js';
import { seedFamily } from './db/seed.js';

/** An app over a database holding the seeded family (Ada, Linus, Marie, Grace). */
function seededApp(): Express {
  const options = testAppOptions();
  seedFamily(options.db);
  return createApp(options).app;
}

describe('GET /api/people', () => {
  it('lists the seeded family in creation order, without a bearer', async () => {
    const res = await request(seededApp()).get('/api/people');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      people: [
        { id: expect.any(Number) as unknown, displayName: 'Ada', color: 'ember', icon: null },
        { id: expect.any(Number) as unknown, displayName: 'Linus', color: 'lake', icon: null },
        { id: expect.any(Number) as unknown, displayName: 'Marie', color: 'moss', icon: null },
        { id: expect.any(Number) as unknown, displayName: 'Grace', color: 'plum', icon: null },
      ],
    });
  });
});

/** The seeded app with PIN 1234 set and an unlocked admin session. */
async function unlockedApp(): Promise<{ app: Express; auth: string }> {
  const app = seededApp();
  return { app, auth: `Bearer ${await setPinAndUnlock(app)}` };
}

describe('POST /api/people', () => {
  it('adds a person after everyone else and answers the new row', async () => {
    const { app, auth } = await unlockedApp();

    const post = await request(app).post('/api/people').set('Authorization', auth).send({ displayName: 'Ada B', color: 'sun' });
    const get = await request(app).get('/api/people');

    expect(post.status).toBe(201);
    expect(post.body).toEqual({ id: expect.any(Number) as unknown, displayName: 'Ada B', color: 'sun', icon: null });
    expect((get.body as { people: unknown[] }).people.at(-1)).toEqual(post.body);
  });

  it('refuses a name already taken ignoring case with 409, adding no one', async () => {
    const { app, auth } = await unlockedApp();

    const post = await request(app).post('/api/people').set('Authorization', auth).send({ displayName: 'aDA', color: 'sun' });
    const get = await request(app).get('/api/people');

    expect(post.status).toBe(409);
    expect(post.body).toEqual({ error: 'Conflict', message: 'Someone already has that name' });
    expect((get.body as { people: unknown[] }).people).toHaveLength(4);
  });

  it.each([
    ['an empty name', { displayName: '', color: 'sun' }, 'Name is required'],
    ['a blank name', { displayName: '   ', color: 'sun' }, 'Name is required'],
    ['a missing name', { color: 'sun' }, 'Name is required'],
    ['a name with a leading space', { displayName: ' Ada B', color: 'sun' }, 'Name must not start or end with a space'],
    ['a name with a trailing space', { displayName: 'Ada B ', color: 'sun' }, 'Name must not start or end with a space'],
    ['a color outside the palette', { displayName: 'Ada B', color: 'tomato' }, 'Color must be one of the palette colors'],
    ['a color value instead of a token', { displayName: 'Ada B', color: '#b23c0a' }, 'Color must be one of the palette colors'],
    ['a missing color', { displayName: 'Ada B' }, 'Color must be one of the palette colors'],
  ])('refuses %s with 400 and a message naming the field', async (_name, body, message) => {
    const { app, auth } = await unlockedApp();

    const res = await request(app).post('/api/people').set('Authorization', auth).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message });
  });

  it('needs a bearer and adds no one without one', async () => {
    const { app } = await unlockedApp();

    const post = await request(app).post('/api/people').send({ displayName: 'Ada B', color: 'sun' });
    const get = await request(app).get('/api/people');

    expect(post.status).toBe(401);
    expect((get.body as { people: unknown[] }).people).toHaveLength(4);
  });
});

/** The seeded person called `name`, as GET /api/people answers. */
async function personNamed(app: Express, name: string): Promise<{ id: number; displayName: string; color: string }> {
  const res = await request(app).get('/api/people');
  const person = (res.body as { people: { id: number; displayName: string; color: string }[] }).people.find(
    (p) => p.displayName === name,
  );
  if (person === undefined) throw new Error(`no ${name} in the seed`);
  return person;
}

describe('PATCH /api/people/:id', () => {
  it('renames and recolors a person in place, keeping the id and the order', async () => {
    const { app, auth } = await unlockedApp();
    const linus = await personNamed(app, 'Linus');

    const patch = await request(app)
      .patch(`/api/people/${String(linus.id)}`)
      .set('Authorization', auth)
      .send({ displayName: 'Lin', color: 'teal' });
    const get = await request(app).get('/api/people');

    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ id: linus.id, displayName: 'Lin', color: 'teal', icon: null });
    expect((get.body as { people: { displayName: string }[] }).people.map((p) => p.displayName)).toEqual([
      'Ada',
      'Lin',
      'Marie',
      'Grace',
    ]);
  });

  it('recolors alone, keeping the name', async () => {
    const { app, auth } = await unlockedApp();
    const marie = await personNamed(app, 'Marie');

    const res = await request(app).patch(`/api/people/${String(marie.id)}`).set('Authorization', auth).send({ color: 'berry' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: marie.id, displayName: 'Marie', color: 'berry', icon: null });
  });

  it('renames alone, including a change of case only', async () => {
    const { app, auth } = await unlockedApp();
    const grace = await personNamed(app, 'Grace');

    const res = await request(app)
      .patch(`/api/people/${String(grace.id)}`)
      .set('Authorization', auth)
      .send({ displayName: 'GRACE' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: grace.id, displayName: 'GRACE', color: 'plum', icon: null });
  });

  it('refuses a rename onto someone else\'s name ignoring case with 409, changing nothing', async () => {
    const { app, auth } = await unlockedApp();
    const grace = await personNamed(app, 'Grace');

    const res = await request(app)
      .patch(`/api/people/${String(grace.id)}`)
      .set('Authorization', auth)
      .send({ displayName: 'marie', color: 'sun' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Conflict', message: 'Someone already has that name' });
    expect(await personNamed(app, 'Grace')).toEqual(grace);
  });

  it.each([
    ['an empty name', { displayName: '' }, 'Name is required'],
    ['an untrimmed name', { displayName: 'Grace ' }, 'Name must not start or end with a space'],
    ['a color outside the palette', { color: 'tomato' }, 'Color must be one of the palette colors'],
    ['a null color', { color: null }, 'Color must be one of the palette colors'],
    ['nothing to change', {}, 'Nothing to change'],
  ])('refuses %s with 400 and a message', async (_name, body, message) => {
    const { app, auth } = await unlockedApp();
    const grace = await personNamed(app, 'Grace');

    const res = await request(app).patch(`/api/people/${String(grace.id)}`).set('Authorization', auth).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message });
    expect(await personNamed(app, 'Grace')).toEqual(grace);
  });

  it.each([['an unknown id', '999'], ['a non-numeric id', 'ada'], ['a zero id', '0']])(
    'answers 404 for %s',
    async (_name, id) => {
      const { app, auth } = await unlockedApp();

      const res = await request(app).patch(`/api/people/${id}`).set('Authorization', auth).send({ color: 'sun' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not Found', message: 'No such person' });
    },
  );

  it('needs a bearer and changes nothing without one', async () => {
    const { app } = await unlockedApp();
    const ada = await personNamed(app, 'Ada');

    const res = await request(app).patch(`/api/people/${String(ada.id)}`).send({ displayName: 'Ada B' });

    expect(res.status).toBe(401);
    expect(await personNamed(app, 'Ada')).toEqual(ada);
  });
});

describe('people edits and change hints', () => {
  it('publishes no hint for an add, a rename or a recolor', async () => {
    const options = testAppOptions();
    seedFamily(options.db);
    const broadcaster = createBroadcaster(captureLogger().logger);
    const hints: FeatureId[] = [];
    broadcaster.subscribe((feature) => hints.push(feature));
    const app = createApp({ ...options, broadcaster }).app;
    const auth = `Bearer ${await setPinAndUnlock(app)}`;
    const ada = await personNamed(app, 'Ada');

    const post = await request(app).post('/api/people').set('Authorization', auth).send({ displayName: 'Ada B', color: 'sun' });
    const patch = await request(app)
      .patch(`/api/people/${String(ada.id)}`)
      .set('Authorization', auth)
      .send({ displayName: 'Ada A', color: 'teal' });

    expect([post.status, patch.status]).toEqual([201, 200]);
    expect(hints).toEqual([]);
  });
});
