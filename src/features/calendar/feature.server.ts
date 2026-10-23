// The calendar feature's server half: its tables, its router (mounted at
// /api/calendar) and its poll job.
//
// Contract (status codes):
//   GET    /events?from&to       200 { events, sources, newestSuccessAt };
//                                400 bad dates, from > to, span over 92 days
//   GET    /sources              200 { sources } (never the address)
//   POST   /sources              201 source after its first fetch; 400 bad
//                                field; 409 duplicate label; 401 no bearer
//   PATCH  /sources/:id          200 source; 400; 404; 409; 401
//   DELETE /sources/:id          204 (secret and events go too); 404; 401
//   POST   /sources/:id/refresh  200 source after the fetch; 404; 401
// Instants on the wire are epoch milliseconds, local dates YYYY-MM-DD
// (docs/adr/0004).
import { Router } from 'express';
import type { Request } from 'express';
import { isPersonColor } from '../../core/personColor.js';
import { daysBetween, parseLocalDate } from '../../core/time.js';
import type { LocalDate } from '../../core/time.js';
import { HttpError, jsonBody } from '../../server/http.js';
import type { FeatureContext, FeatureJob, Migration, ServerFeature } from '../types.js';
import type { StoredEvent } from './eventRepository.js';
import { InvalidSecretUrlError, SecretUrl } from './secretUrl.js';
import { createCalendarService } from './service.js';
import { DuplicateLabelError } from './sourceRepository.js';
import type { CalendarSource, SourcePatch } from './sourceRepository.js';
import type { CalendarEventWire, EventsResponse, SourceWire, SourcesResponse } from './types.js';

/** The longest range GET /events serves: a month view with its margins. */
export const MAX_EVENTS_SPAN_DAYS = 92;
export const POLL_INTERVAL_MS = 10 * 60_000;

const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'create calendar_source, calendar_source_secret and calendar_event',
    sql: `
      CREATE TABLE calendar_source (
        id              INTEGER PRIMARY KEY,
        label           TEXT NOT NULL CHECK (label <> '' AND label = trim(label)),
        -- A palette token, the same rule as person.color.
        color           TEXT NOT NULL
                        CHECK (color GLOB '[a-z]*' AND NOT color GLOB '*[^a-z]*'),
        -- Host plus a short hash of the address (SecretUrl.fingerprint):
        -- what admin shows in place of the address, which is never here.
        url_fingerprint TEXT NOT NULL CHECK (url_fingerprint <> ''),
        created_at      INTEGER NOT NULL,
        last_attempt_at INTEGER,
        last_success_at INTEGER,
        -- A classification (timeout, http <status>, not-ics, too-large,
        -- network), never a message: a message could quote the address.
        last_error      TEXT CHECK (last_error IS NULL OR last_error <> ''),
        -- VEVENTs of the last successful fetch that could not be read.
        skipped_count   INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0)
      ) STRICT;

      CREATE UNIQUE INDEX calendar_source_label ON calendar_source (label COLLATE NOCASE);

      -- The address alone, in its own table so the source row mapper never
      -- selects it; only the fetch path reads here.
      CREATE TABLE calendar_source_secret (
        source_id INTEGER PRIMARY KEY REFERENCES calendar_source (id) ON DELETE CASCADE,
        url       TEXT NOT NULL CHECK (url <> '')
      ) STRICT;

      -- Stored occurrences within the poll window; replaced wholesale on
      -- each successful fetch of their source.
      CREATE TABLE calendar_event (
        id            INTEGER PRIMARY KEY,
        source_id     INTEGER NOT NULL REFERENCES calendar_source (id) ON DELETE CASCADE,
        uid           TEXT NOT NULL,
        -- The RECURRENCE-ID of an overridden instance, else NULL.
        recurrence_id TEXT,
        kind          TEXT NOT NULL CHECK (kind IN ('timed', 'all_day')),
        -- Timed: instants, end not before start.
        start_at      INTEGER,
        end_at        INTEGER,
        -- All-day: local dates, end exclusive (so always after start).
        start_date    TEXT CHECK (start_date IS NULL OR date(start_date) IS start_date),
        end_date      TEXT CHECK (end_date IS NULL OR date(end_date) IS end_date),
        title         TEXT NOT NULL,
        location      TEXT CHECK (location IS NULL OR location <> ''),
        -- Exactly the pair matching kind is set.
        CHECK (
          (kind = 'timed' AND start_at IS NOT NULL AND end_at IS NOT NULL
             AND end_at >= start_at AND start_date IS NULL AND end_date IS NULL)
          OR
          (kind = 'all_day' AND start_date IS NOT NULL AND end_date IS NOT NULL
             AND end_date > start_date AND start_at IS NULL AND end_at IS NULL)
        )
      ) STRICT;

      CREATE INDEX calendar_event_source ON calendar_event (source_id);
      CREATE INDEX calendar_event_instants ON calendar_event (start_at, end_at);
      CREATE INDEX calendar_event_dates ON calendar_event (start_date, end_date);
    `,
  },
];

function serviceFor(ctx: FeatureContext) {
  return createCalendarService({
    db: ctx.db,
    fetch: ctx.fetch,
    logger: ctx.logger,
    now: ctx.now,
    zone: ctx.config.zone,
  });
}

function createRouter(ctx: FeatureContext): Router {
  const service = serviceFor(ctx);
  const router = Router();

  router.get('/events', (req, res) => {
    const { from, to } = eventsRange(req);
    const result = service.eventsBetween(from, to);
    const body: EventsResponse = {
      events: result.events.map(toEventWire),
      sources: result.sources.map(({ id, label, color }) => ({ id, label, color })),
      newestSuccessAt: result.newestSuccessAt?.getTime() ?? null,
    };
    res.json(body);
  });

  router.get('/sources', (_req, res) => {
    const body: SourcesResponse = { sources: service.listSources().map(toSourceWire) };
    res.json(body);
  });

  router.post('/sources', ctx.requireAdmin, jsonBody, async (req, res) => {
    const body = bodyOf(req.body);
    const input = {
      label: labelOf(body.label),
      color: colorOf(body.color),
      url: urlOf(body.url),
    };
    const source = await withDomainErrors(() => service.addSource(input));
    ctx.broadcaster.publish('calendar');
    res.status(201).json(toSourceWire(source));
  });

  router.patch('/sources/:id', ctx.requireAdmin, jsonBody, async (req, res) => {
    const id = idOf(req);
    const body = bodyOf(req.body);
    const patch: SourcePatch = {};
    if ('label' in body) patch.label = labelOf(body.label);
    if ('color' in body) patch.color = colorOf(body.color);
    if ('url' in body) patch.url = urlOf(body.url);
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change');
    const source = await withDomainErrors(() => service.patchSource(id, patch));
    if (source === undefined) throw notFound();
    ctx.broadcaster.publish('calendar');
    res.json(toSourceWire(source));
  });

  router.delete('/sources/:id', ctx.requireAdmin, (req, res) => {
    if (!service.deleteSource(idOf(req))) throw notFound();
    ctx.broadcaster.publish('calendar');
    res.status(204).end();
  });

  router.post('/sources/:id/refresh', ctx.requireAdmin, async (req, res) => {
    const source = await service.refreshSource(idOf(req));
    if (source === undefined) throw notFound();
    res.json(toSourceWire(source));
  });

  return router;
}

/**
 * The poll job: every source, every 10 minutes and once at boot, each
 * fetched on its own. #19 adds the change digest and the hint.
 */
function createJob(ctx: FeatureContext): FeatureJob {
  const service = serviceFor(ctx);
  return {
    name: 'calendar poll',
    intervalMs: POLL_INTERVAL_MS,
    run: () => service.refreshAll(),
  };
}

export const calendarServer = {
  id: 'calendar',
  name: 'Calendar',
  migrations,
  createRouter,
  createJob,
} satisfies ServerFeature;

// Validation. Every message is written for the client and repeats nothing
// the client sent, in particular never the address.

function eventsRange(req: Request): { from: LocalDate; to: LocalDate } {
  const from = parseLocalDate(queryText(req.query['from']));
  const to = parseLocalDate(queryText(req.query['to']));
  if (from === undefined) throw new HttpError(400, 'from must be a date as YYYY-MM-DD');
  if (to === undefined) throw new HttpError(400, 'to must be a date as YYYY-MM-DD');
  const span = daysBetween(from, to);
  if (span < 0) throw new HttpError(400, 'from must not be after to');
  if (span >= MAX_EVENTS_SPAN_DAYS) {
    throw new HttpError(400, `from and to may span at most ${MAX_EVENTS_SPAN_DAYS} days`);
  }
  return { from, to };
}

/** A query value as text; a repeated or nested parameter is no date. */
function queryText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idOf(req: Request): number {
  const raw = req.params['id'];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) throw notFound();
  return Number(raw);
}

function notFound(): HttpError {
  return new HttpError(404, 'No such calendar');
}

function labelOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, 'Label is required');
  return value.trim();
}

function colorOf(value: unknown) {
  if (typeof value !== 'string' || !isPersonColor(value)) {
    throw new HttpError(400, 'Color must be one of the palette colors');
  }
  return value;
}

function urlOf(value: unknown): SecretUrl {
  if (typeof value !== 'string') throw new HttpError(400, 'Address is required');
  try {
    return SecretUrl.parse(value);
  } catch (err) {
    if (err instanceof InvalidSecretUrlError) throw new HttpError(400, err.message);
    throw err;
  }
}

async function withDomainErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof DuplicateLabelError) throw new HttpError(409, err.message);
    throw err;
  }
}

function bodyOf(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function toSourceWire(source: CalendarSource): SourceWire {
  return {
    id: source.id,
    label: source.label,
    color: source.color,
    fingerprint: source.fingerprint,
    createdAt: source.createdAt.getTime(),
    lastAttemptAt: source.lastAttemptAt?.getTime() ?? null,
    lastSuccessAt: source.lastSuccessAt?.getTime() ?? null,
    lastError: source.lastError,
    skippedCount: source.skippedCount,
  };
}

function toEventWire(event: StoredEvent): CalendarEventWire {
  const base = {
    id: event.id,
    sourceId: event.sourceId,
    uid: event.uid,
    recurrenceId: event.recurrenceId,
    title: event.title,
    location: event.location,
  };
  return event.kind === 'timed'
    ? { ...base, kind: 'timed', startAt: event.startAt.getTime(), endAt: event.endAt.getTime() }
    : { ...base, kind: 'allDay', startDate: event.startDate, endDate: event.endDate };
}
