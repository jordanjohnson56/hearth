// The board, claims and undo, through Supertest against the app factory
// with a throwaway SQLite file and an injected clock. Every test that
// counts or lists completions includes a voided one that must not count.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { featureHarness } from '../../../test/helpers/featureHarness.js';
import type { FeatureHarness } from '../../../test/helpers/featureHarness.js';
import { seedFamily } from '../../server/db/seed.js';
import { getCompletion } from './completionRepository.js';
import { choresServer } from './feature.server.js';
import type { BoardResponse, ChoreWire } from './types.js';

// Friday 2026-10-23 12:00 in Chicago (CDT, UTC-5). This week began Monday
// 2026-10-19 00:00 CDT (05:00Z). Expected values are worked out by hand.
const NOW = new Date('2026-10-23T17:00:00Z');
const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;

const ADA = 1;
const LINUS = 2;
const MARIE = 3;
const GRACE = 4;

/** The harness with the fictional family seeded: Ada 1, Linus 2, Marie 3, Grace 4. */
async function harness(start = NOW): Promise<FeatureHarness> {
  const h = await featureHarness([choresServer], start);
  seedFamily(h.db);
  return h;
}

async function addChore(
  h: FeatureHarness,
  name: string,
  rule: Record<string, unknown>,
  points: number,
  startDate: string,
): Promise<ChoreWire> {
  const res = await request(h.app)
    .post('/api/chores/definitions')
    .set('Authorization', `Bearer ${h.token}`)
    .send({ name, rule, points, startDate });
  expect(res.status).toBe(201);
  return res.body as ChoreWire;
}

async function board(h: FeatureHarness): Promise<BoardResponse> {
  const res = await request(h.app).get('/api/chores/board');
  expect(res.status).toBe(200);
  return res.body as BoardResponse;
}

function claim(h: FeatureHarness, choreId: number | string, body: unknown) {
  return request(h.app).post(`/api/chores/${String(choreId)}/claims`).send(body as object);
}

async function claimed(h: FeatureHarness, choreId: number, personId: number): Promise<number> {
  const res = await claim(h, choreId, { personId });
  expect(res.status).toBe(201);
  return (res.body as { id: number }).id;
}

function undo(h: FeatureHarness, completionId: number | string) {
  return request(h.app).post(`/api/chores/completions/${String(completionId)}/undo`);
}

const pointsOf = (b: BoardResponse) => Object.fromEntries(b.standings.map((s) => [s.personId, s.points]));

describe('GET /api/chores/board', () => {
  it('answers without a bearer with everyone at zero and nothing to do', async () => {
    const h = await harness();

    expect(await board(h)).toEqual({
      today: '2026-10-23',
      weekStart: new Date('2026-10-19T05:00:00Z').getTime(),
      people: [
        { id: ADA, displayName: 'Ada', color: 'ember', icon: null },
        { id: LINUS, displayName: 'Linus', color: 'lake', icon: null },
        { id: MARIE, displayName: 'Marie', color: 'moss', icon: null },
        { id: GRACE, displayName: 'Grace', color: 'plum', icon: null },
      ],
      waiting: [],
      anytime: [],
      upcoming: [],
      completions: [],
      standings: [
        { rank: 1, personId: ADA, points: 0 },
        { rank: 1, personId: GRACE, points: 0 },
        { rank: 1, personId: LINUS, points: 0 },
        { rank: 1, personId: MARIE, points: 0 },
      ],
    });
  });

  it('sorts every chore into its section in the spec order, archived ones nowhere', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-20');
    // Every 3 days from Thursday the 22nd: the 22nd was missed.
    await addChore(h, 'Water the plants', { kind: 'every', unit: 'days', interval: 3 }, 3, '2026-10-22');
    await addChore(h, 'Empty the bins', { kind: 'weekly', days: ['fri'] }, 4, '2026-10-23');
    await addChore(h, 'Clean the hob', { kind: 'daily' }, 4, '2026-10-23');
    await addChore(h, 'Wipe the table', { kind: 'daily' }, 1, '2026-10-23');
    await addChore(h, 'Change the sheets', { kind: 'monthly', day: 31 }, 6, '2026-11-01');
    await addChore(h, 'Vacuum the hall', { kind: 'weekly', days: ['wed', 'sat'] }, 3, '2026-10-24');
    await addChore(h, 'Wash the car', { kind: 'whenever' }, 5, '2026-10-01');
    await addChore(h, 'Bake a cake', { kind: 'whenever' }, 8, '2026-10-01');
    const snow = await addChore(h, 'Shovel the snow', { kind: 'daily' }, 9, '2026-10-01');
    await request(h.app)
      .patch(`/api/chores/definitions/${String(snow.id)}`)
      .set('Authorization', `Bearer ${h.token}`)
      .send({ archived: true });

    const b = await board(h);

    expect(b.waiting).toEqual([
      { id: 1, name: 'Feed the dog', points: 2, state: 'overdue', daysLate: 3 },
      { id: 2, name: 'Water the plants', points: 3, state: 'overdue', daysLate: 1 },
      { id: 4, name: 'Clean the hob', points: 4, state: 'due-today' },
      { id: 3, name: 'Empty the bins', points: 4, state: 'due-today' },
      { id: 5, name: 'Wipe the table', points: 1, state: 'due-today' },
    ]);
    expect(b.upcoming).toEqual([
      { id: 7, name: 'Vacuum the hall', points: 3, nextDue: '2026-10-24' },
      { id: 6, name: 'Change the sheets', points: 6, nextDue: '2026-11-30' },
    ]);
    expect(b.anytime).toEqual([
      { id: 9, name: 'Bake a cake', points: 8, claimedToday: false },
      { id: 8, name: 'Wash the car', points: 5, claimedToday: false },
    ]);
  });

  it("lists this week's completions that count, newest first, and totals them", async () => {
    // Sunday 2026-10-18 23:00 CDT: last week.
    const h = await harness(new Date('2026-10-19T04:00:00Z'));
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-01');
    await addChore(h, 'Wash the car', { kind: 'whenever' }, 5, '2026-10-01');
    await claimed(h, 1, GRACE);
    h.advance(HOUR_MS); // Monday 00:00 CDT: this week.
    const first = await claimed(h, 1, ADA);
    h.advance(HOUR_MS);
    const voided = await claimed(h, 2, LINUS);
    await undo(h, voided);
    h.advance(HOUR_MS);
    const latest = await claimed(h, 2, ADA);

    const b = await board(h);

    expect(b.completions).toEqual([
      {
        id: latest,
        choreId: 2,
        choreName: 'Wash the car',
        personId: ADA,
        completedAt: new Date('2026-10-19T07:00:00Z').getTime(),
        pointsAwarded: 5,
      },
      {
        id: first,
        choreId: 1,
        choreName: 'Feed the dog',
        personId: ADA,
        completedAt: new Date('2026-10-19T05:00:00Z').getTime(),
        pointsAwarded: 2,
      },
    ]);
    expect(b.standings).toEqual([
      { rank: 1, personId: ADA, points: 7 },
      { rank: 2, personId: GRACE, points: 0 },
      { rank: 2, personId: LINUS, points: 0 },
      { rank: 2, personId: MARIE, points: 0 },
    ]);
  });

  it('keeps the points awarded when the chore is worth more later', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    await claimed(h, 1, MARIE);
    await request(h.app)
      .patch('/api/chores/definitions/1')
      .set('Authorization', `Bearer ${h.token}`)
      .send({ points: 10 });

    const b = await board(h);

    expect(pointsOf(b)[MARIE]).toBe(2);
    expect(b.completions.map((c) => c.pointsAwarded)).toEqual([2]);
    expect(b.upcoming).toEqual([{ id: 1, name: 'Feed the dog', points: 10, nextDue: '2026-10-24' }]);
  });

  it('turns over at midnight in the zone, not in UTC', async () => {
    // Friday 23:59 CDT is already Saturday in UTC.
    const h = await harness(new Date('2026-10-24T04:59:00Z'));
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-01');
    await claimed(h, 1, ADA);

    expect((await board(h)).waiting).toEqual([]);
    h.advance(60 * SECOND_MS);
    expect((await board(h)).waiting).toEqual([{ id: 1, name: 'Feed the dog', points: 2, state: 'due-today' }]);
    expect((await board(h)).today).toBe('2026-10-24');
  });
});

describe('POST /api/chores/:id/claims', () => {
  it('answers 201 with the completion, drops the chore from the pool and raises the standing', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    h.hints.length = 0;

    const res = await claim(h, 1, { personId: LINUS });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1, choreId: 1, personId: LINUS, completedAt: NOW.getTime(), pointsAwarded: 2 });
    expect(h.hints).toEqual(['chores']);
    const b = await board(h);
    expect(b.waiting).toEqual([]);
    expect(b.upcoming).toEqual([{ id: 1, name: 'Feed the dog', points: 2, nextDue: '2026-10-24' }]);
    expect(b.standings[0]).toEqual({ rank: 1, personId: LINUS, points: 2 });
  });

  it('clears a 3-day backlog with one completion worth the points once', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-20');
    expect((await board(h)).waiting).toMatchObject([{ state: 'overdue', daysLate: 3 }]);

    await claimed(h, 1, ADA);

    const b = await board(h);
    expect(b.waiting).toEqual([]);
    expect(b.completions).toHaveLength(1);
    expect(pointsOf(b)[ADA]).toBe(2);
  });

  it('refuses a chore that is not waiting with 409', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    await claimed(h, 1, ADA);
    h.hints.length = 0;

    const sameDay = await claim(h, 1, { personId: LINUS });
    const future = await addChore(h, 'Change the sheets', { kind: 'monthly', day: 1 }, 6, '2026-11-01');
    const early = await claim(h, future.id, { personId: LINUS });

    expect([sameDay.status, early.status]).toEqual([409, 409]);
    expect(sameDay.body).toMatchObject({ message: 'That chore is not waiting' });
    expect(h.hints).toEqual(['chores']); // the add only
  });

  it('refuses an archived chore with 409', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-20');
    await request(h.app)
      .patch('/api/chores/definitions/1')
      .set('Authorization', `Bearer ${h.token}`)
      .send({ archived: true });

    const res = await claim(h, 1, { personId: ADA });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: 'That chore is archived' });
  });

  it('takes an anytime chore once per local day, again after an undo or the next day', async () => {
    const h = await harness();
    await addChore(h, 'Wash the car', { kind: 'whenever' }, 5, '2026-10-01');

    const undone = await claimed(h, 1, ADA);
    await undo(h, undone);
    await claimed(h, 1, LINUS);
    const again = await claim(h, 1, { personId: MARIE });
    expect((await board(h)).anytime).toEqual([{ id: 1, name: 'Wash the car', points: 5, claimedToday: true }]);
    h.advance(12 * HOUR_MS); // Saturday 00:00 CDT
    const tomorrow = await claim(h, 1, { personId: MARIE });

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ message: 'That chore was already claimed today' });
    expect(tomorrow.status).toBe(201);
    expect(pointsOf(await board(h))).toEqual({ [ADA]: 0, [LINUS]: 5, [MARIE]: 5, [GRACE]: 0 });
  });

  it.each([
    ['an id no chore has', 99],
    ['an id that is not a number', 'abc'],
  ])('answers 404 for %s', async (_label, id) => {
    const h = await harness();

    const res = await claim(h, id, { personId: ADA });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'No such chore' });
  });

  it.each([
    ['no one has that id', { personId: 99 }, 'No such person'],
    ['the person id is missing', {}, 'Choose who did it'],
    ['the person id is not a whole number', { personId: '2' }, 'Choose who did it'],
  ])('answers 400 when %s', async (_label, body, error) => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    h.hints.length = 0;

    const res = await claim(h, 1, body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: error });
    expect(h.hints).toEqual([]);
    expect((await board(h)).waiting).toHaveLength(1);
  });
});

describe('POST /api/chores/completions/:id/undo', () => {
  it('voids the completion with reason undo at 14 s, without a bearer, and the chore waits again', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    const id = await claimed(h, 1, ADA);
    h.hints.length = 0;
    h.advance(14 * SECOND_MS);

    const res = await undo(h, id);

    expect(res.status).toBe(204);
    expect(h.hints).toEqual(['chores']);
    expect(getCompletion(h.db, id)?.voided).toEqual({
      voidedAt: new Date(NOW.getTime() + 14 * SECOND_MS),
      reason: 'undo',
    });
    const b = await board(h);
    expect(b.waiting).toEqual([{ id: 1, name: 'Feed the dog', points: 2, state: 'due-today' }]);
    expect(b.completions).toEqual([]);
    expect(pointsOf(b)[ADA]).toBe(0);
  });

  it('accepts an undo at exactly 15 s', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    const id = await claimed(h, 1, ADA);
    h.advance(15 * SECOND_MS);

    expect((await undo(h, id)).status).toBe(204);
  });

  it('refuses an undo at 16 s with 409 and the completion still counts', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    const id = await claimed(h, 1, ADA);
    h.hints.length = 0;
    h.advance(16 * SECOND_MS);

    const res = await undo(h, id);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: 'Too late to undo. An admin can void it.' });
    expect(h.hints).toEqual([]);
    expect(getCompletion(h.db, id)?.voided).toBeNull();
    expect(pointsOf(await board(h))[ADA]).toBe(2);
  });

  it.each([
    ['already voided', 1],
    ['unknown', 2],
    ['not a number', 'x'],
  ])('answers 404 for a completion that is %s', async (_label, id) => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    await claimed(h, 1, ADA);
    await undo(h, 1);
    h.hints.length = 0;

    const res = await undo(h, id);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'No such completion' });
    expect(h.hints).toEqual([]);
  });
});
