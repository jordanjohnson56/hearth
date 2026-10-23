import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp, testAppOptions } from '../../../test/helpers/app.js';
import { fakeFetch, feedResponse, networkError, timeoutError } from '../../../test/helpers/fetch.js';
import type { FakeEndpoint } from '../../../test/helpers/fetch.js';
import { icalFixture } from '../../../test/helpers/ical.js';
import { captureLogger } from '../../../test/helpers/logger.js';
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
