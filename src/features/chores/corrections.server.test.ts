// Admin corrections (void, reassign) and the 14-day completion list,
// through Supertest against the app factory with a throwaway SQLite file
// and an injected clock. Expected values are worked out by hand.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { unlock } from '../../../test/helpers/admin.js';
import { featureHarness } from '../../../test/helpers/featureHarness.js';
import type { FeatureHarness } from '../../../test/helpers/featureHarness.js';
import { seedFamily } from '../../server/db/seed.js';
import { getCompletion } from './completionRepository.js';
import { choresServer } from './feature.server.js';
import type { BoardResponse, ChoreWire, CompletionsResponse } from './types.js';

// Friday 2026-10-23 12:00 in Chicago (CDT, UTC-5). This week began Monday
// 2026-10-19 00:00 CDT (05:00Z).
const NOW = new Date('2026-10-23T17:00:00Z');
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

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

async function claimed(h: FeatureHarness, choreId: number, personId: number): Promise<number> {
  const res = await request(h.app)
    .post(`/api/chores/${String(choreId)}/claims`)
    .send({ personId });
  expect(res.status).toBe(201);
  return (res.body as { id: number }).id;
}

function voidIt(h: FeatureHarness, completionId: number | string, token: string | null = h.token) {
  const req = request(h.app).post(`/api/chores/completions/${String(completionId)}/void`);
  return token === null ? req : req.set('Authorization', `Bearer ${token}`);
}

function reassign(h: FeatureHarness, completionId: number | string, body: unknown, token: string | null = h.token) {
  const req = request(h.app).post(`/api/chores/completions/${String(completionId)}/reassign`);
  return (token === null ? req : req.set('Authorization', `Bearer ${token}`)).send(body as object);
}

const pointsOf = (b: BoardResponse) => Object.fromEntries(b.standings.map((s) => [s.personId, s.points]));

describe('POST /api/chores/completions/:id/void', () => {
  it('voids a completion after the undo window with reason correction, and the chore waits again', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    const id = await claimed(h, 1, ADA);
    h.hints.length = 0;
    h.advance(5 * MINUTE_MS);

    const res = await voidIt(h, id);

    expect(res.status).toBe(204);
    expect(h.hints).toEqual(['chores']);
    expect(getCompletion(h.db, id)?.voided).toEqual({
      voidedAt: new Date(NOW.getTime() + 5 * MINUTE_MS),
      reason: 'correction',
    });
    const b = await board(h);
    expect(b.waiting).toEqual([{ id: 1, name: 'Feed the dog', points: 2, state: 'due-today' }]);
    expect(b.completions).toEqual([]);
    expect(pointsOf(b)).toEqual({
      [ADA]: 0,
      [LINUS]: 0,
      [MARIE]: 0,
      [GRACE]: 0,
    });
  });

  it.each([
    ['already voided by an undo', 1],
    ['already voided by a correction', 2],
    ['unknown', 3],
    ['not a number', 'x'],
  ])('answers 404 for a completion that is %s', async (_label, id) => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    await claimed(h, 1, ADA);
    await request(h.app).post('/api/chores/completions/1/undo');
    await claimed(h, 1, LINUS);
    expect((await voidIt(h, 2)).status).toBe(204);
    h.hints.length = 0;

    const res = await voidIt(h, id);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'No such completion' });
    expect(h.hints).toEqual([]);
  });

  it('answers 401 without a bearer and the completion still counts', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    const id = await claimed(h, 1, ADA);
    h.hints.length = 0;

    const res = await voidIt(h, id, null);

    expect(res.status).toBe(401);
    expect(h.hints).toEqual([]);
    expect(getCompletion(h.db, id)?.voided).toBeNull();
  });
});

describe('POST /api/chores/completions/:id/reassign', () => {
  it('voids the original and records the other person at the original instant with the original points', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    const original = await claimed(h, 1, LINUS);
    h.hints.length = 0;
    h.advance(5 * MINUTE_MS);

    const res = await reassign(h, original, { personId: MARIE });

    expect(res.status).toBe(201);
    const moved = (res.body as { id: number }).id;
    expect(res.body).toEqual({
      id: moved,
      choreId: 1,
      personId: MARIE,
      completedAt: NOW.getTime(),
      pointsAwarded: 2,
    });
    expect(moved).not.toBe(original);
    expect(h.hints).toEqual(['chores']);
    expect(getCompletion(h.db, original)?.voided).toEqual({
      voidedAt: new Date(NOW.getTime() + 5 * MINUTE_MS),
      reason: 'correction',
    });
    const b = await board(h);
    expect(pointsOf(b)).toEqual({
      [ADA]: 0,
      [LINUS]: 0,
      [MARIE]: 2,
      [GRACE]: 0,
    });
    expect(b.completions).toEqual([
      {
        id: moved,
        choreId: 1,
        choreName: 'Feed the dog',
        personId: MARIE,
        completedAt: NOW.getTime(),
        pointsAwarded: 2,
      },
    ]);
    expect(b.waiting).toEqual([]);
  });

  it('keeps a Sunday claim fixed on Monday in last week', async () => {
    // Sunday 2026-10-18 23:00 CDT.
    const h = await harness(new Date('2026-10-19T04:00:00Z'));
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-01');
    const sunday = await claimed(h, 1, LINUS);
    h.advance(10 * HOUR_MS); // Monday 09:00 CDT
    const token = await unlock(h.app);

    const res = await reassign(h, sunday, { personId: ADA }, token);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      personId: ADA,
      completedAt: new Date('2026-10-19T04:00:00Z').getTime(),
    });
    const b = await board(h);
    expect(b.completions).toEqual([]);
    expect(pointsOf(b)).toEqual({
      [ADA]: 0,
      [LINUS]: 0,
      [MARIE]: 0,
      [GRACE]: 0,
    });
    expect(b.waiting).toEqual([{ id: 1, name: 'Feed the dog', points: 2, state: 'due-today' }]);
  });

  it.each([
    ['the same person', { personId: LINUS }, 'That is already who did it'],
    ['no one has that id', { personId: 99 }, 'No such person'],
    ['the person id is missing', {}, 'Choose who did it'],
    ['the person id is not a whole number', { personId: '3' }, 'Choose who did it'],
  ])('answers 400 for %s and changes nothing', async (_label, body, message) => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    const original = await claimed(h, 1, LINUS);
    h.hints.length = 0;

    const res = await reassign(h, original, body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message });
    expect(h.hints).toEqual([]);
    expect(getCompletion(h.db, original)?.voided).toBeNull();
    const b = await board(h);
    expect(b.completions.map((c) => [c.id, c.personId])).toEqual([[original, LINUS]]);
  });

  it.each([
    ['already voided by an undo', 1],
    ['already voided by a reassignment', 2],
    ['unknown', 4],
    ['not a number', 'x'],
  ])('answers 404 for a completion that is %s', async (_label, id) => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    await claimed(h, 1, ADA);
    await request(h.app).post('/api/chores/completions/1/undo');
    await claimed(h, 1, LINUS);
    expect((await reassign(h, 2, { personId: MARIE })).status).toBe(201); // completion 3
    h.hints.length = 0;

    const res = await reassign(h, id, { personId: GRACE });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'No such completion' });
    expect(h.hints).toEqual([]);
    expect(pointsOf(await board(h))).toEqual({
      [ADA]: 0,
      [LINUS]: 0,
      [MARIE]: 2,
      [GRACE]: 0,
    });
  });

  it('answers 401 without a bearer and changes nothing', async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    const original = await claimed(h, 1, LINUS);
    h.hints.length = 0;

    const res = await reassign(h, original, { personId: MARIE }, null);

    expect(res.status).toBe(401);
    expect(h.hints).toEqual([]);
    expect(getCompletion(h.db, original)?.voided).toBeNull();
  });
});

describe("the week's standings (DESIGN.md section 11)", () => {
  it("do not change when a chore's points change after a claim, nor when that claim is reassigned", async () => {
    const h = await harness();
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-23');
    await addChore(h, 'Wash the car', { kind: 'whenever' }, 5, '2026-10-01');
    const dog = await claimed(h, 1, ADA);
    const voided = await claimed(h, 2, LINUS);
    expect((await voidIt(h, voided)).status).toBe(204);
    await claimed(h, 2, GRACE);
    const before = (await board(h)).standings;
    expect(before).toEqual([
      { rank: 1, personId: GRACE, points: 5 },
      { rank: 2, personId: ADA, points: 2 },
      { rank: 3, personId: LINUS, points: 0 },
      { rank: 3, personId: MARIE, points: 0 },
    ]);

    for (const [id, points] of [
      [1, 10],
      [2, 1],
    ] as const) {
      const res = await request(h.app)
        .patch(`/api/chores/definitions/${String(id)}`)
        .set('Authorization', `Bearer ${h.token}`)
        .send({ points });
      expect(res.status).toBe(200);
    }

    expect((await board(h)).standings).toEqual(before);

    const res = await reassign(h, dog, { personId: MARIE });
    expect(res.body).toMatchObject({ pointsAwarded: 2 });
    expect(pointsOf(await board(h))).toEqual({
      [ADA]: 0,
      [LINUS]: 0,
      [MARIE]: 2,
      [GRACE]: 5,
    });
  });
});

describe('GET /api/chores/completions', () => {
  /**
   * Completions 1 to 5 of Feed the dog (2 pts) and Wash the car (5 pts):
   * 1 is 14 days and a minute old, 2 exactly 14 days (voided as a
   * correction), 3 undone, 4 reassigned to make 5. The clock ends at NOW.
   */
  async function history(): Promise<FeatureHarness & { admin: string }> {
    const h = await harness(new Date(NOW.getTime() - 14 * DAY_MS - MINUTE_MS));
    await addChore(h, 'Feed the dog', { kind: 'daily' }, 2, '2026-10-01');
    await addChore(h, 'Wash the car', { kind: 'whenever' }, 5, '2026-10-01');
    await claimed(h, 1, ADA);
    h.advance(MINUTE_MS);
    await claimed(h, 2, LINUS);
    h.advance(14 * DAY_MS - HOUR_MS);
    await claimed(h, 1, MARIE);
    await request(h.app).post('/api/chores/completions/3/undo');
    await claimed(h, 1, GRACE);
    h.advance(MINUTE_MS);
    const admin = await unlock(h.app);
    expect((await reassign(h, 4, { personId: LINUS }, admin)).status).toBe(201);
    h.advance(MINUTE_MS);
    expect((await voidIt(h, 2, admin)).status).toBe(204);
    h.advance(HOUR_MS - 2 * MINUTE_MS);
    return { ...h, admin: await unlock(h.app) };
  }

  function list(h: FeatureHarness, token: string | null, query = '') {
    const req = request(h.app).get(`/api/chores/completions${query}`);
    return token === null ? req : req.set('Authorization', `Bearer ${token}`);
  }

  const at = (iso: string) => new Date(iso).getTime();

  it('lists the last 14 days newest first, voided ones included with their reasons', async () => {
    const h = await history();

    const res = await list(h, h.admin, '?days=14');

    expect(res.status).toBe(200);
    const body = res.body as CompletionsResponse;
    expect(body.since).toBe(at('2026-10-09T17:00:00Z'));
    expect(body.people.map((p) => p.displayName)).toEqual(['Ada', 'Linus', 'Marie', 'Grace']);
    expect(body.completions).toEqual([
      {
        id: 5,
        choreId: 1,
        choreName: 'Feed the dog',
        personId: LINUS,
        completedAt: at('2026-10-23T16:00:00Z'),
        pointsAwarded: 2,
        voided: null,
      },
      {
        id: 4,
        choreId: 1,
        choreName: 'Feed the dog',
        personId: GRACE,
        completedAt: at('2026-10-23T16:00:00Z'),
        pointsAwarded: 2,
        voided: { voidedAt: at('2026-10-23T16:01:00Z'), reason: 'correction' },
      },
      {
        id: 3,
        choreId: 1,
        choreName: 'Feed the dog',
        personId: MARIE,
        completedAt: at('2026-10-23T16:00:00Z'),
        pointsAwarded: 2,
        voided: { voidedAt: at('2026-10-23T16:00:00Z'), reason: 'undo' },
      },
      {
        id: 2,
        choreId: 2,
        choreName: 'Wash the car',
        personId: LINUS,
        completedAt: at('2026-10-09T17:00:00Z'),
        pointsAwarded: 5,
        voided: { voidedAt: at('2026-10-23T16:02:00Z'), reason: 'correction' },
      },
    ]);
  });

  it('covers 14 days when no days are given, and fewer when asked', async () => {
    const h = await history();

    const all = await list(h, h.admin);
    const today = await list(h, h.admin, '?days=1');

    expect((all.body as CompletionsResponse).completions.map((c) => c.id)).toEqual([5, 4, 3, 2]);
    expect((today.body as CompletionsResponse).completions.map((c) => c.id)).toEqual([5, 4, 3]);
    expect((today.body as CompletionsResponse).since).toBe(at('2026-10-22T17:00:00Z'));
  });

  it('moves with the injected clock', async () => {
    const h = await history();
    h.advance(MINUTE_MS);
    const admin = await unlock(h.app);

    const res = await list(h, admin);

    expect((res.body as CompletionsResponse).completions.map((c) => c.id)).toEqual([5, 4, 3]);
  });

  it.each(['?days=0', '?days=15', '?days=2.5', '?days=abc'])('answers 400 for %s', async (query) => {
    const h = await harness();

    const res = await list(h, h.token, query);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'Days must be a whole number from 1 to 14',
    });
  });

  it('answers 401 without a bearer', async () => {
    const h = await harness();

    expect((await list(h, null)).status).toBe(401);
  });
});
