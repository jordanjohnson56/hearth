import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp, testAppOptions } from '../../../test/helpers/app.js';
import { fakeFetch, feedResponse, networkError, timeoutError } from '../../../test/helpers/fetch.js';
import type { FakeEndpoint } from '../../../test/helpers/fetch.js';
import { icalFixture } from '../../../test/helpers/ical.js';
import { captureLogger } from '../../../test/helpers/logger.js';
import { createApp } from '../../server/app.js';
import { createBroadcaster } from '../../server/broadcaster.js';
import { appliedMigrations, runMigrations } from '../../server/db/migrate.js';
import { migrationSets } from '../../server/db/schema.js';
import { calendarServer } from './feature.server.js';
import type { SourceWire } from './types.js';

const ADA_URL = 'https://cal.example/feeds/ada/private-feed-0123456789abcdef.txt';
const MARIE_URL = 'https://cal.example/feeds/marie/private-feed-fedcba9876543210.txt';
/** 2026-10-23 12:00 in Chicago: the poll window is 2026-07-01 .. 2027-10-31. */
const NOW = new Date('2026-10-23T17:00:00Z');

interface Harness {
  app: Express;
  token: string;
  calls: string[];
  text: () => string;
  /** Moves the injected clock forward. */
  advance: (ms: number) => void;
}

/** An app with PIN 1234 set and unlocked, the calendar feature and a fake network. */
async function harness(
  endpoints: Record<string, FakeEndpoint> | FakeEndpoint,
  overrides: Partial<Parameters<typeof testAppOptions>[0]> = {},
): Promise<Harness> {
  const { fetch, calls } = fakeFetch(endpoints);
  const { logger, text } = captureLogger();
  let at = NOW.getTime();
  const app = testApp({ features: [calendarServer], fetch, logger, now: () => new Date(at), ...overrides });
  await request(app).put('/api/admin/pin').send({ pin: '1234' });
  const unlocked = await request(app).post('/api/admin/unlock').send({ pin: '1234' });
  return {
    app,
    token: (unlocked.body as { token: string }).token,
    calls,
    text,
    advance: (ms) => {
      at += ms;
    },
  };
}

const ADA = { label: 'Ada', color: 'ember', url: ADA_URL };

async function addSource(h: Harness, body: Record<string, unknown> = ADA) {
  return request(h.app).post('/api/calendar/sources').set('Authorization', `Bearer ${h.token}`).send(body);
}

async function listSources(h: Harness): Promise<SourceWire[]> {
  const res = await request(h.app).get('/api/calendar/sources');
  return (res.body as { sources: SourceWire[] }).sources;
}

async function eventsBetween(h: Harness, from: string, to: string) {
  return request(h.app).get('/api/calendar/events').query({ from, to });
}

describe('calendar#1', () => {
  it('applies after core#1 on a fresh database and a second run is a no-op', () => {
    const options = testAppOptions({ features: [calendarServer] });

    const refs = appliedMigrations(options.db).map((m) => `${m.scope}#${String(m.id)}`);
    const again = runMigrations(options.db, migrationSets([calendarServer]), NOW);

    expect(refs).toEqual(['core#1', 'calendar#1']);
    expect(again.applied).toEqual([]);
  });
});

describe('POST /api/calendar/sources', () => {
  it('saves the source, fetches it once and answers 201 with the first result', async () => {
    const h = await harness({ [ADA_URL]: () => feedResponse(icalFixture('single-events')) });

    const res = await addSource(h);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 1,
      label: 'Ada',
      color: 'ember',
      fingerprint: expect.stringMatching(/^cal\.example#[0-9a-f]{8}$/) as string,
      createdAt: NOW.getTime(),
      lastAttemptAt: NOW.getTime(),
      lastSuccessAt: NOW.getTime(),
      lastError: null,
      skippedCount: 0,
    });
    expect(h.calls).toEqual([ADA_URL]);
    expect(await listSources(h)).toEqual([res.body]);
  });

  it('accepts a webcal address and fetches it over https', async () => {
    const h = await harness({ [ADA_URL]: () => feedResponse(icalFixture('empty')) });
    const webcal = ['webcal', ADA_URL.slice('https'.length)].join('');

    const res = await addSource(h, { ...ADA, url: webcal });

    expect(res.status).toBe(201);
    expect(h.calls).toEqual([ADA_URL]);
  });

  it('keeps a source whose first fetch failed and reports the failure on it', async () => {
    const h = await harness({});

    const res = await addSource(h);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ lastAttemptAt: NOW.getTime(), lastSuccessAt: null, lastError: 'network' });
    expect(await listSources(h)).toHaveLength(1);
  });

  it('reports how many VEVENTs in the feed could not be read', async () => {
    const h = await harness({ [ADA_URL]: () => feedResponse(icalFixture('edge-cases')) });

    const res = await addSource(h);

    expect(res.body).toMatchObject({ lastError: null, skippedCount: 2 });
  });

  it.each([
    ['a missing label', { color: 'ember', url: ADA_URL }, /label/i],
    ['a blank label', { label: '  ', color: 'ember', url: ADA_URL }, /label/i],
    ['a color outside the palette', { label: 'Ada', color: 'red', url: ADA_URL }, /color/i],
    ['a missing url', { label: 'Ada', color: 'ember' }, /address/i],
    ['an http url', { label: 'Ada', color: 'ember', url: 'http://cal.example/feed' }, /https/],
    ['a relative url', { label: 'Ada', color: 'ember', url: 'cal.example/feed' }, /address/i],
  ])('refuses %s with a 400 and a field message', async (_label, body, message) => {
    const h = await harness({});

    const res = await addSource(h, body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message: expect.stringMatching(message) as string });
    expect(h.calls).toEqual([]);
    expect(await listSources(h)).toEqual([]);
  });

  it('refuses a duplicate label, ignoring case, with a 409', async () => {
    const h = await harness(() => feedResponse(icalFixture('empty')));
    await addSource(h);

    const res = await addSource(h, { label: 'ada', color: 'lake', url: MARIE_URL });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Conflict', message: expect.stringMatching(/label/i) as string });
    expect(await listSources(h)).toHaveLength(1);
  });

  it('answers a bare 401 without a bearer', async () => {
    const h = await harness({});

    const res = await request(h.app).post('/api/calendar/sources').send(ADA);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});

describe('fetch failures', () => {
  /** A source fetched once from a good feed, so the failure has rows to leave alone. */
  async function sourceWithEvents(failing: FakeEndpoint): Promise<Harness> {
    let attempt = 0;
    const h = await harness({
      [ADA_URL]: () => {
        attempt += 1;
        return attempt === 1 ? feedResponse(icalFixture('single-events')) : failing();
      },
    });
    await addSource(h);
    return h;
  }

  async function refresh(h: Harness, id = 1) {
    return request(h.app)
      .post(`/api/calendar/sources/${String(id)}/refresh`)
      .set('Authorization', `Bearer ${h.token}`);
  }

  it.each<[string, FakeEndpoint, string]>([
    ['a 404', () => feedResponse('not here', 404), 'http 404'],
    ['a 500', () => feedResponse('', 500), 'http 500'],
    ['a timeout', () => Promise.reject(timeoutError()), 'timeout'],
    ['a body over the 5 MB cap', () => feedResponse(icalFixture('empty').replace('END:VCALENDAR', `X-PAD:${'a'.repeat(5 * 1024 * 1024)}\r\nEND:VCALENDAR`)), 'too-large'],
    ['an HTML page instead of iCalendar', () => feedResponse(icalFixture('html-page')), 'not-ics'],
    ['a network error', () => Promise.reject(networkError(ADA_URL)), 'network'],
  ])('stores the classification for %s and leaves the events alone', async (_label, failing, classification) => {
    const h = await sourceWithEvents(failing);
    // The clock moves so the attempt and the earlier success are told apart.
    h.advance(300_000);

    const res = await refresh(h);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      lastError: classification,
      lastAttemptAt: NOW.getTime() + 300_000,
      lastSuccessAt: NOW.getTime(),
      skippedCount: 0,
    });
    const events = await eventsBetween(h, '2026-10-24', '2026-10-25');
    expect((events.body as { events: unknown[] }).events).toHaveLength(2);
  });

  it('succeeds with zero events for an empty but valid feed, replacing the old rows', async () => {
    const h = await sourceWithEvents(() => feedResponse(icalFixture('empty')));

    const res = await refresh(h);

    expect(res.body).toMatchObject({ lastError: null, skippedCount: 0 });
    const events = await eventsBetween(h, '2026-10-24', '2026-10-25');
    expect((events.body as { events: unknown[] }).events).toEqual([]);
  });
});

/** The gitleaks shapes (Google secret address, webcal) plus this file's own secret paths. */
const URL_SCAN = new RegExp(
  [
    'https://calendar\\.google\\.com/calendar/ical/[^/\\s"\']+/private-?[0-9a-fA-F]{16,}/basic\\.ics',
    ['webcal', '://[^\\s"\']+'].join(''),
    'private-feed-[0-9a-f]{16}',
    'feeds/(ada|marie)',
  ].join('|'),
);

describe('PATCH /api/calendar/sources/:id', () => {
  async function patch(h: Harness, id: number, body: Record<string, unknown>) {
    return request(h.app)
      .patch(`/api/calendar/sources/${String(id)}`)
      .set('Authorization', `Bearer ${h.token}`)
      .send(body);
  }

  it('changes the label and color without fetching again', async () => {
    const h = await harness({ [ADA_URL]: () => feedResponse(icalFixture('single-events')) });
    await addSource(h);

    const res = await patch(h, 1, { label: 'Ada work', color: 'lake' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, label: 'Ada work', color: 'lake', lastSuccessAt: NOW.getTime() });
    expect(h.calls).toEqual([ADA_URL]);
  });

  it('clears the events and status for a new address and fetches it', async () => {
    const h = await harness({
      [ADA_URL]: () => feedResponse(icalFixture('single-events')),
      [MARIE_URL]: () => feedResponse(icalFixture('empty')),
    });
    await addSource(h);
    h.advance(60_000);

    const res = await patch(h, 1, { url: MARIE_URL });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fingerprint: expect.not.stringMatching(/9ec50bcd/) as string,
      lastAttemptAt: NOW.getTime() + 60_000,
      lastSuccessAt: NOW.getTime() + 60_000,
      lastError: null,
    });
    expect(h.calls).toEqual([ADA_URL, MARIE_URL]);
    const events = await eventsBetween(h, '2026-10-24', '2026-10-25');
    expect((events.body as { events: unknown[] }).events).toEqual([]);
  });

  it('clears the events even when the new address fails to fetch', async () => {
    const h = await harness({ [ADA_URL]: () => feedResponse(icalFixture('single-events')) });
    await addSource(h);

    const res = await patch(h, 1, { url: MARIE_URL });

    expect(res.body).toMatchObject({ lastSuccessAt: null, lastError: 'network' });
    const events = await eventsBetween(h, '2026-10-24', '2026-10-25');
    expect((events.body as { events: unknown[] }).events).toEqual([]);
  });

  it('refuses a duplicate label with a 409 and a bad field with a 400', async () => {
    const h = await harness(() => feedResponse(icalFixture('empty')));
    await addSource(h);
    await addSource(h, { label: 'Marie', color: 'lake', url: MARIE_URL });

    expect((await patch(h, 2, { label: 'ADA' })).status).toBe(409);
    expect((await patch(h, 2, { color: 'red' })).status).toBe(400);
    expect((await patch(h, 2, { url: 'http://cal.example/x' })).status).toBe(400);
    expect((await patch(h, 2, {})).status).toBe(400);
    expect((await listSources(h))[1]).toMatchObject({ label: 'Marie', color: 'lake' });
  });

  it('answers 404 for an unknown or malformed id', async () => {
    const h = await harness({});

    expect((await patch(h, 7, { label: 'x' })).status).toBe(404);
    const res = await request(h.app)
      .patch('/api/calendar/sources/abc')
      .set('Authorization', `Bearer ${h.token}`)
      .send({ label: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/calendar/sources/:id', () => {
  it('removes the source with its events and answers 204', async () => {
    const h = await harness({ [ADA_URL]: () => feedResponse(icalFixture('single-events')) });
    await addSource(h);

    const res = await request(h.app).delete('/api/calendar/sources/1').set('Authorization', `Bearer ${h.token}`);

    expect(res.status).toBe(204);
    expect(await listSources(h)).toEqual([]);
    const events = await eventsBetween(h, '2026-10-24', '2026-10-25');
    expect(events.body).toEqual({ events: [], sources: [], newestSuccessAt: null });
  });

  it('answers 404 for an unknown id', async () => {
    const h = await harness({});

    const res = await request(h.app).delete('/api/calendar/sources/1').set('Authorization', `Bearer ${h.token}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/calendar/sources/:id/refresh', () => {
  it('answers 404 for an unknown id', async () => {
    const h = await harness({});

    const res = await request(h.app).post('/api/calendar/sources/1/refresh').set('Authorization', `Bearer ${h.token}`);

    expect(res.status).toBe(404);
  });
});

describe('bearer gating', () => {
  it.each([
    ['POST /api/calendar/sources', (app: Express) => request(app).post('/api/calendar/sources').send(ADA)],
    ['PATCH /api/calendar/sources/1', (app: Express) => request(app).patch('/api/calendar/sources/1').send({ label: 'x' })],
    ['DELETE /api/calendar/sources/1', (app: Express) => request(app).delete('/api/calendar/sources/1')],
    ['POST /api/calendar/sources/1/refresh', (app: Express) => request(app).post('/api/calendar/sources/1/refresh')],
  ])('%s answers a bare 401 without a bearer', async (_label, send) => {
    const h = await harness(() => feedResponse(icalFixture('empty')));
    await addSource(h);

    const res = await send(h.app);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});

describe('GET /api/calendar/events', () => {
  async function withEdgeCases(): Promise<Harness> {
    const h = await harness({
      [ADA_URL]: () => feedResponse(icalFixture('single-events')),
      [MARIE_URL]: () => feedResponse(icalFixture('edge-cases')),
    });
    await addSource(h);
    h.advance(60_000);
    await addSource(h, { label: 'Marie', color: 'lake', url: MARIE_URL });
    return h;
  }

  it('returns the events in the range with instants as epoch ms and dates as YYYY-MM-DD, plus the legend', async () => {
    const h = await withEdgeCases();

    const res = await eventsBetween(h, '2026-10-24', '2026-10-25');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      events: [
        {
          id: expect.any(Number) as number,
          sourceId: 1,
          uid: 'no-school@cal.example',
          recurrenceId: null,
          title: 'Linus no school',
          location: null,
          kind: 'allDay',
          startDate: '2026-10-25',
          endDate: '2026-10-26',
        },
        {
          id: expect.any(Number) as number,
          sourceId: 2,
          uid: 'late-flight@cal.example',
          recurrenceId: null,
          title: 'Marie late flight',
          location: null,
          kind: 'timed',
          startAt: Date.parse('2026-10-24T02:00:00Z'),
          endAt: Date.parse('2026-10-24T06:00:00Z'),
        },
        {
          id: expect.any(Number) as number,
          sourceId: 1,
          uid: 'dentist@cal.example',
          recurrenceId: null,
          title: 'Ada dentist',
          location: 'Oak Street Dental',
          kind: 'timed',
          startAt: Date.parse('2026-10-24T14:00:00Z'),
          endAt: Date.parse('2026-10-24T15:30:00Z'),
        },
      ],
      sources: [
        { id: 1, label: 'Ada', color: 'ember' },
        { id: 2, label: 'Marie', color: 'lake' },
      ],
      newestSuccessAt: NOW.getTime() + 60_000,
    });
  });

  it('returns a timed event from 21:00 to 01:00 Chicago on both local days', async () => {
    const h = await withEdgeCases();

    const day1 = await eventsBetween(h, '2026-10-23', '2026-10-23');
    const day2 = await eventsBetween(h, '2026-10-24', '2026-10-24');

    const uids = (res: request.Response) => (res.body as { events: { uid: string }[] }).events.map((e) => e.uid);
    expect(uids(day1)).toEqual(['late-flight@cal.example']);
    expect(uids(day2)).toContain('late-flight@cal.example');
  });

  it('returns an all-day event across a month boundary for both months', async () => {
    const h = await withEdgeCases();

    const october = await eventsBetween(h, '2026-10-01', '2026-10-31');
    const november = await eventsBetween(h, '2026-11-01', '2026-11-30');

    const uids = (res: request.Response) => (res.body as { events: { uid: string }[] }).events.map((e) => e.uid);
    expect(uids(october)).toContain('camp@cal.example');
    expect(uids(november)).toContain('camp@cal.example');
    // The exclusive end: Nov 3 is not covered.
    const nov3 = await eventsBetween(h, '2026-11-03', '2026-11-03');
    expect(uids(nov3)).not.toContain('camp@cal.example');
  });

  it('reports null newestSuccessAt while no source has succeeded, and the newest success otherwise', async () => {
    const h = await harness({ [MARIE_URL]: () => feedResponse(icalFixture('empty')) });
    await addSource(h);
    expect((await eventsBetween(h, '2026-10-01', '2026-10-31')).body).toMatchObject({ newestSuccessAt: null });

    h.advance(60_000);
    await addSource(h, { label: 'Marie', color: 'lake', url: MARIE_URL });
    expect((await eventsBetween(h, '2026-10-01', '2026-10-31')).body).toMatchObject({
      newestSuccessAt: NOW.getTime() + 60_000,
    });
  });

  it('accepts a 92-day span', async () => {
    const h = await harness({});
    expect((await eventsBetween(h, '2026-01-01', '2026-04-02')).status).toBe(200);
  });

  it.each([
    ['a missing from', { to: '2026-10-31' }, /from/],
    ['a malformed to', { from: '2026-10-01', to: '31/10/2026' }, /to/],
    ['an impossible date', { from: '2026-02-30', to: '2026-03-01' }, /from/],
    ['from after to', { from: '2026-10-02', to: '2026-10-01' }, /after/],
    ['a span over 92 days', { from: '2026-01-01', to: '2026-04-03' }, /92 days/],
  ])('refuses %s with a 400 and a field message', async (_label, query, message) => {
    const h = await harness({});

    const res = await request(h.app).get('/api/calendar/events').query(query);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message: expect.stringMatching(message) as string });
  });
});

describe('redirects', () => {
  const HOP1 = 'https://cal.example/r/1';
  const HOP2 = 'https://cal.example/r/2';
  const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

  it('follows up to two https redirects', async () => {
    const h = await harness({
      [ADA_URL]: redirect('/r/1'),
      [HOP1]: redirect(HOP2),
      [HOP2]: () => feedResponse(icalFixture('empty')),
    });

    const res = await addSource(h);

    expect(res.body).toMatchObject({ lastError: null });
    expect(h.calls).toEqual([ADA_URL, HOP1, HOP2]);
  });

  it('refuses a third redirect and reports the redirect status', async () => {
    const h = await harness({
      [ADA_URL]: redirect(HOP1),
      [HOP1]: redirect(HOP2),
      [HOP2]: redirect('https://cal.example/r/3'),
    });

    const res = await addSource(h);

    expect(res.body).toMatchObject({ lastError: 'http 302' });
    expect(h.calls).toEqual([ADA_URL, HOP1, HOP2]);
  });

  it('refuses a redirect to http', async () => {
    const h = await harness({ [ADA_URL]: redirect('http://cal.example/plain') });

    const res = await addSource(h);

    expect(res.body).toMatchObject({ lastError: 'http 302' });
    expect(h.calls).toEqual([ADA_URL]);
  });
});

describe('change hints and the poll job', () => {
  it('publishes a calendar hint after add, edit and delete', async () => {
    const { logger } = captureLogger();
    const broadcaster = createBroadcaster(logger);
    const hints: string[] = [];
    broadcaster.subscribe((feature) => hints.push(feature));
    const h = await harness(() => feedResponse(icalFixture('empty')), { broadcaster });

    await addSource(h);
    await request(h.app).patch('/api/calendar/sources/1').set('Authorization', `Bearer ${h.token}`).send({ label: 'Ada 2' });
    await request(h.app).delete('/api/calendar/sources/1').set('Authorization', `Bearer ${h.token}`);

    expect(hints).toEqual(['calendar', 'calendar', 'calendar']);
  });

  it('polls every source every 10 minutes, each on its own', async () => {
    const { fetch, calls } = fakeFetch({
      [ADA_URL]: () => feedResponse(icalFixture('single-events')),
    });
    const options = testAppOptions({ features: [calendarServer], fetch, now: () => NOW });
    const { app, jobs } = createApp(options);
    await request(app).put('/api/admin/pin').send({ pin: '1234' });
    const { token } = (await request(app).post('/api/admin/unlock').send({ pin: '1234' })).body as { token: string };
    await request(app).post('/api/calendar/sources').set('Authorization', `Bearer ${token}`).send(ADA);
    await request(app).post('/api/calendar/sources').set('Authorization', `Bearer ${token}`).send({ label: 'Marie', color: 'lake', url: MARIE_URL });
    calls.length = 0;

    expect(jobs.map((job) => [job.name, job.intervalMs])).toEqual([['calendar poll', 600_000]]);
    await jobs[0]?.run();

    expect(calls.sort()).toEqual([ADA_URL, MARIE_URL].sort());
    const sources = (await request(app).get('/api/calendar/sources')).body as { sources: SourceWire[] };
    expect(sources.sources.map((s) => s.lastError)).toEqual([null, 'network']);
  });
});

describe('URL scan', () => {
  it('finds no address in logs, error messages or any calendar response, including a failed first fetch', async () => {
    const h = await harness({
      [ADA_URL]: () => feedResponse(icalFixture('single-events')),
      [MARIE_URL]: () => Promise.reject(networkError(MARIE_URL)),
    });
    const bodies: string[] = [];
    bodies.push((await addSource(h)).text);
    bodies.push((await addSource(h, { label: 'Marie', color: 'lake', url: MARIE_URL })).text);
    bodies.push((await addSource(h, { label: 'Grace', color: 'moss', url: ['webcal', MARIE_URL.slice(5)].join('') })).text);
    bodies.push((await addSource(h, { label: 'Linus', color: 'moss', url: 'http://cal.example/feeds/linus/private-feed-0000000000000000.txt' })).text);
    bodies.push((await request(h.app).patch('/api/calendar/sources/2').set('Authorization', `Bearer ${h.token}`).send({ url: MARIE_URL })).text);
    bodies.push((await request(h.app).post('/api/calendar/sources/2/refresh').set('Authorization', `Bearer ${h.token}`)).text);
    bodies.push((await request(h.app).get('/api/calendar/sources')).text);
    bodies.push((await eventsBetween(h, '2026-10-01', '2026-10-31')).text);
    bodies.push((await eventsBetween(h, 'nope', '2026-10-31')).text);

    expect(h.text()).toContain('calendar fetch failed');
    for (const text of [h.text(), ...bodies]) {
      expect(text).not.toMatch(URL_SCAN);
      expect(text).not.toContain('cal.example/');
    }
  });
});
