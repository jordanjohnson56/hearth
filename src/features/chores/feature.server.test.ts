import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { featureHarness } from '../../../test/helpers/featureHarness.js';
import type { FeatureHarness } from '../../../test/helpers/featureHarness.js';
import { testAppOptions } from '../../../test/helpers/app.js';
import type { AppOptions } from '../../server/app.js';
import { appliedMigrations, runMigrations } from '../../server/db/migrate.js';
import { migrationSets } from '../../server/db/schema.js';
import { choresServer } from './feature.server.js';
import type { ChoreWire, DefinitionsResponse } from './types.js';

/** Friday 2026-10-23 12:00 in Chicago. */
const NOW = new Date('2026-10-23T17:00:00Z');
/** Short enough that the admin session (10 minutes idle) stays live. */
const MINUTE_MS = 60_000;

type Harness = FeatureHarness;

/** An app with PIN 1234 set and unlocked, the chores feature, an injected clock and counted hints. */
function harness(overrides: Partial<AppOptions> = {}): Promise<Harness> {
  return featureHarness([choresServer], NOW, overrides);
}

const FEED_THE_DOG = { name: 'Feed the dog', rule: { kind: 'daily' }, points: 2, startDate: '2026-10-01' };

function addChore(h: Harness, body: Record<string, unknown> = FEED_THE_DOG) {
  return request(h.app).post('/api/chores/definitions').set('Authorization', `Bearer ${h.token}`).send(body);
}

function patchChore(h: Harness, id: number | string, body: Record<string, unknown>) {
  return request(h.app)
    .patch(`/api/chores/definitions/${String(id)}`)
    .set('Authorization', `Bearer ${h.token}`)
    .send(body);
}

async function listChores(h: Harness): Promise<ChoreWire[]> {
  const res = await request(h.app).get('/api/chores/definitions').set('Authorization', `Bearer ${h.token}`);
  expect(res.status).toBe(200);
  return (res.body as DefinitionsResponse).chores;
}

describe('chores#1', () => {
  it('applies after core#1 on a fresh database and a second run is a no-op', () => {
    const options = testAppOptions({ features: [choresServer] });

    const refs = appliedMigrations(options.db).map((m) => `${m.scope}#${String(m.id)}`);
    const again = runMigrations(options.db, migrationSets([choresServer]), NOW);

    expect(refs).toEqual(['core#1', 'chores#1']);
    expect(again.applied).toEqual([]);
  });

  it('creates chore, completion and completion_void as STRICT tables', () => {
    const { db } = testAppOptions({ features: [choresServer] });

    const tables = db
      .prepare(
        "SELECT name, strict FROM pragma_table_list WHERE name IN ('chore', 'completion', 'completion_void') ORDER BY name",
      )
      .all();

    expect(tables).toEqual([
      { name: 'chore', strict: 1 },
      { name: 'completion', strict: 1 },
      { name: 'completion_void', strict: 1 },
    ]);
  });
});

describe('POST /api/chores/definitions', () => {
  it('saves the chore and answers 201 with it', async () => {
    const h = await harness();

    const res = await addChore(h);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 1,
      name: 'Feed the dog',
      rule: { kind: 'daily' },
      points: 2,
      startDate: '2026-10-01',
      archivedAt: null,
      createdAt: NOW.getTime(),
    });
    expect(await listChores(h)).toEqual([res.body]);
  });

  it('trims the name and stores the rule in its canonical form', async () => {
    const h = await harness();

    const res = await addChore(h, {
      ...FEED_THE_DOG,
      name: '  Vacuum the hall ',
      rule: { kind: 'weekly', days: ['sat', 'wed'] },
    });

    expect(res.body).toMatchObject({ name: 'Vacuum the hall', rule: { kind: 'weekly', days: ['wed', 'sat'] } });
  });

  it("defaults the start date to today's local date in the configured zone", async () => {
    // 03:00Z on the 24th is still the evening of the 23rd in Chicago.
    const h = await harness({ now: () => new Date('2026-10-24T03:00:00Z') });
    const res = await addChore(h, { ...FEED_THE_DOG, startDate: undefined });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startDate: '2026-10-23' });
  });

  it('accepts a start date in the future', async () => {
    const h = await harness();

    const res = await addChore(h, { ...FEED_THE_DOG, startDate: '2027-06-01' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startDate: '2027-06-01' });
  });

  it.each([1, 1000])('accepts %i points', async (points) => {
    const h = await harness();

    const res = await addChore(h, { ...FEED_THE_DOG, points });

    expect(res.status).toBe(201);
  });

  it('refuses a duplicate name, ignoring case, with a 409', async () => {
    const h = await harness();
    await addChore(h);

    const res = await addChore(h, { ...FEED_THE_DOG, name: 'feed THE dog' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Conflict', message: 'Another chore already has that name' });
    expect(await listChores(h)).toHaveLength(1);
  });

  it.each([
    ['a missing name', { name: undefined }, 'Name is required'],
    ['a blank name', { name: '   ' }, 'Name is required'],
    ['a name that is not text', { name: 7 }, 'Name is required'],
    ['0 points', { points: 0 }, 'Points must be a whole number from 1 to 1000'],
    ['1001 points', { points: 1001 }, 'Points must be a whole number from 1 to 1000'],
    ['fractional points', { points: 2.5 }, 'Points must be a whole number from 1 to 1000'],
    ['points as text', { points: '2' }, 'Points must be a whole number from 1 to 1000'],
    ['missing points', { points: undefined }, 'Points must be a whole number from 1 to 1000'],
    ['an empty weekday set', { rule: { kind: 'weekly', days: [] } }, 'Choose at least one weekday'],
    ['every with interval 1', { rule: { kind: 'every', unit: 'days', interval: 1 } }, 'The interval must be a whole number of 2 or more (use daily or weekly for 1)'],
    ['monthly day 32', { rule: { kind: 'monthly', day: 32 } }, 'The day of the month must be a whole number from 1 to 31'],
    ['an unknown rule kind', { rule: { kind: 'yearly' } }, 'The rule must be daily, weekly, every, monthly or whenever'],
    ['a rule sent as text', { rule: '{"kind":"daily"}' }, 'The rule must be daily, weekly, every, monthly or whenever'],
    ['a missing rule', { rule: undefined }, 'The rule must be daily, weekly, every, monthly or whenever'],
    ['an impossible start date', { startDate: '2026-02-30' }, 'Start date must be a date as YYYY-MM-DD'],
    ['a start date without leading zeros', { startDate: '2026-2-1' }, 'Start date must be a date as YYYY-MM-DD'],
    ['a start date with a time', { startDate: '2026-10-01T00:00' }, 'Start date must be a date as YYYY-MM-DD'],
    ['a start date as an instant', { startDate: Date.UTC(2026, 9, 1) }, 'Start date must be a date as YYYY-MM-DD'],
  ])('refuses %s with a 400 and a field message', async (_label, change, message) => {
    const h = await harness();

    const res = await addChore(h, { ...FEED_THE_DOG, ...change });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message });
    expect(await listChores(h)).toEqual([]);
  });
});

describe('PATCH /api/chores/definitions/:id', () => {
  it('changes the name, rule, points and start date', async () => {
    const h = await harness();
    await addChore(h);

    const res = await patchChore(h, 1, {
      name: 'Walk the dog',
      rule: { kind: 'every', unit: 'days', interval: 2 },
      points: 5,
      startDate: '2026-11-01',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 1,
      name: 'Walk the dog',
      rule: { kind: 'every', unit: 'days', interval: 2 },
      points: 5,
      startDate: '2026-11-01',
      archivedAt: null,
      createdAt: NOW.getTime(),
    });
    expect(await listChores(h)).toEqual([res.body]);
  });

  it('changes one field and leaves the others alone', async () => {
    const h = await harness();
    await addChore(h);

    const res = await patchChore(h, 1, { points: 3 });

    expect(res.body).toMatchObject({ name: 'Feed the dog', rule: { kind: 'daily' }, points: 3, startDate: '2026-10-01' });
  });

  it('accepts a new spelling of its own name', async () => {
    const h = await harness();
    await addChore(h);

    const res = await patchChore(h, 1, { name: 'Feed the Dog' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Feed the Dog' });
  });

  it('archives at the current instant and unarchives, keeping the chore', async () => {
    const h = await harness();
    await addChore(h);
    h.advance(MINUTE_MS);

    const archived = await patchChore(h, 1, { archived: true });
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ archivedAt: NOW.getTime() + MINUTE_MS });

    const unarchived = await patchChore(h, 1, { archived: false });
    expect(unarchived.status).toBe(200);
    expect(unarchived.body).toMatchObject({ archivedAt: null, name: 'Feed the dog' });
  });

  it('keeps the first archive instant when archived twice', async () => {
    const h = await harness();
    await addChore(h);
    await patchChore(h, 1, { archived: true });
    h.advance(MINUTE_MS);

    const again = await patchChore(h, 1, { archived: true });

    expect(again.body).toMatchObject({ archivedAt: NOW.getTime() });
  });

  it('lists archived chores along with the others, flagged by archivedAt', async () => {
    const h = await harness();
    await addChore(h);
    await addChore(h, { ...FEED_THE_DOG, name: 'Shovel the snow', rule: { kind: 'whenever' } });
    await patchChore(h, 2, { archived: true });

    const chores = await listChores(h);

    expect(chores.map(({ name, archivedAt }) => ({ name, archivedAt }))).toEqual([
      { name: 'Feed the dog', archivedAt: null },
      { name: 'Shovel the snow', archivedAt: NOW.getTime() },
    ]);
  });

  it('refuses a rename onto another chore’s name, ignoring case, with a 409', async () => {
    const h = await harness();
    await addChore(h);
    await addChore(h, { ...FEED_THE_DOG, name: 'Water the plants' });

    const res = await patchChore(h, 2, { name: 'FEED the dog' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Conflict', message: 'Another chore already has that name' });
    expect((await listChores(h)).map((chore) => chore.name)).toEqual(['Feed the dog', 'Water the plants']);
  });

  it.each([
    ['a blank name', { name: '' }, 'Name is required'],
    ['out-of-range points', { points: 1001 }, 'Points must be a whole number from 1 to 1000'],
    ['a malformed rule', { rule: { kind: 'monthly', day: 0 } }, 'The day of the month must be a whole number from 1 to 31'],
    ['a bad start date', { startDate: '2026-13-01' }, 'Start date must be a date as YYYY-MM-DD'],
    ['archived that is not true or false', { archived: 'yes' }, 'Archived must be true or false'],
  ])('refuses %s with a 400 and a field message, applying none of the patch', async (_label, body, message) => {
    const h = await harness();
    const added = await addChore(h);

    const res = await patchChore(h, 1, { points: 7, ...body });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message });
    expect(await listChores(h)).toEqual([added.body]);
  });

  it('refuses an empty body with a 400', async () => {
    const h = await harness();
    await addChore(h);

    const res = await patchChore(h, 1, {});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message: 'Nothing to change' });
  });

  it.each(['2', '0', 'one', '1.5'])('answers 404 for chore id %s that does not exist', async (id) => {
    const h = await harness();
    await addChore(h);

    const res = await patchChore(h, id, { points: 3 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found', message: 'No such chore' });
  });
});

describe('the bearer gate', () => {
  it.each([
    ['GET', '/api/chores/definitions'],
    ['POST', '/api/chores/definitions'],
    ['PATCH', '/api/chores/definitions/1'],
  ])('answers %s %s with a bare 401 without a bearer, changing nothing', async (method, path) => {
    const h = await harness();
    await addChore(h);
    h.hints.length = 0;

    const call = request(h.app);
    const res = await (method === 'GET'
      ? call.get(path)
      : method === 'POST'
        ? call.post(path).send({ ...FEED_THE_DOG, name: 'Water the plants' })
        : call.patch(path).send({ points: 9 }));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(await listChores(h)).toMatchObject([{ name: 'Feed the dog', points: 2 }]);
    expect(h.hints).toEqual([]);
  });
});

describe('change hints', () => {
  it('publishes a chores hint on add, edit, archive and unarchive', async () => {
    const h = await harness();

    await addChore(h);
    await patchChore(h, 1, { points: 3 });
    await patchChore(h, 1, { archived: true });
    await patchChore(h, 1, { archived: false });

    expect(h.hints).toEqual(['chores', 'chores', 'chores', 'chores']);
  });

  it('publishes nothing for a read or a refused write', async () => {
    const h = await harness();
    await addChore(h);
    h.hints.length = 0;

    await listChores(h);
    await addChore(h);
    await patchChore(h, 1, { points: 0 });
    await patchChore(h, 9, { points: 3 });

    expect(h.hints).toEqual([]);
  });
});

describe('a stored rule the code cannot read', () => {
  it('is a logged 500, not a chore that silently vanishes', async () => {
    const h = await harness();
    await addChore(h);
    h.db.prepare("UPDATE chore SET rule = '{\"kind\":\"yearly\"}' WHERE id = 1").run();

    const res = await request(h.app).get('/api/chores/definitions').set('Authorization', `Bearer ${h.token}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(h.lines().at(-1)).toMatchObject({
      level: 50,
      path: '/api/chores/definitions',
      status: 500,
      err: { message: expect.stringMatching(/chore 1 has a rule Hearth cannot read/) as string },
    });
  });
});
