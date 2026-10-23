// Orchestration for calendar sources: add, change, delete and refresh, each
// a fetch through the fetcher, a parse through the provider and one
// transaction over the repositories. Routers and the poll job call this;
// nothing here knows HTTP.
//
// Change hints: a refresh compares the digest of the rows it replaces with
// the digest of the rows it writes, so the hint rule needs no memory of
// earlier polls (a restart or a second process changes nothing). A poll
// pass or a refresh publishes `calendar` only when a digest changed; an
// admin add, change or delete is the router's hint, published once there.
import type { Database } from 'better-sqlite3';
import { localDateRangeToInstants, addDays } from '../../core/time.js';
import type { LocalDate } from '../../core/time.js';
import type { Broadcaster } from '../../server/broadcaster.js';
import type { Logger } from '../../server/logger.js';
import { digestOf } from './digest.js';
import { listEventsBetween, listEventsOf, replaceEvents, deleteEvents } from './eventRepository.js';
import type { StoredEvent } from './eventRepository.js';
import { fetchFeed } from './fetcher.js';
import { NotIcsError, parseFeed } from './provider.js';
import {
  deleteSource,
  getSource,
  insertSource,
  listSources,
  readSourceSecret,
  recordFetchFailure,
  recordFetchSuccess,
  updateSource,
} from './sourceRepository.js';
import type { CalendarSource, SourceInput, SourcePatch } from './sourceRepository.js';
import type { FetchFailure } from './types.js';
import { pollWindow } from './window.js';

export interface CalendarServiceOptions {
  db: Database;
  broadcaster: Broadcaster;
  fetch: typeof globalThis.fetch;
  logger: Logger;
  now: () => Date;
  zone: string;
}

export interface EventsBetween {
  events: StoredEvent[];
  sources: CalendarSource[];
  /** The newest successful fetch across sources, or null when none succeeded yet. */
  newestSuccessAt: Date | null;
}

export interface CalendarService {
  listSources(): CalendarSource[];
  getSource(id: number): CalendarSource | undefined;
  /** Saves and fetches once; a failed first fetch keeps the row. */
  addSource(input: SourceInput): Promise<CalendarSource>;
  /** A new address clears the events and status and refetches. Undefined when there is no such source. */
  patchSource(id: number, patch: SourcePatch): Promise<CalendarSource | undefined>;
  /** True when a source was deleted (with its secret and events). */
  deleteSource(id: number): boolean;
  /** Fetches again now, publishing a hint if the events changed. Undefined when there is no such source. */
  refreshSource(id: number): Promise<CalendarSource | undefined>;
  /**
   * Refreshes every source, each on its own: one failing leaves the others
   * alone. Publishes one hint when any source's events changed.
   */
  refreshAll(): Promise<void>;
  /** Occurrences overlapping the inclusive local dates, with the legend and staleness input. */
  eventsBetween(from: LocalDate, to: LocalDate): EventsBetween;
}

export function createCalendarService(options: CalendarServiceOptions): CalendarService {
  const { db, broadcaster, fetch, logger, now, zone } = options;

  /** Fetches and stores one source. True when its stored events changed. */
  async function refresh(id: number): Promise<boolean> {
    const url = readSourceSecret(db, id);
    if (url === undefined) return false;
    const at = now();
    const outcome = await fetchFeed(fetch, url);
    if (!outcome.ok) {
      fail(id, at, outcome.failure);
      return false;
    }
    const window = pollWindow(at, zone);
    let parsed;
    try {
      parsed = parseFeed(outcome.text, { ...window, zone });
    } catch (err) {
      if (err instanceof NotIcsError) {
        fail(id, at, 'not-ics');
        return false;
      }
      throw err;
    }
    // Rows and status land together: a reader never sees new rows with the
    // old status or the reverse. Skipped if the source was deleted meanwhile.
    const changed = db.transaction(() => {
      if (getSource(db, id) === undefined) return false;
      const before = digestOf(listEventsOf(db, id));
      replaceEvents(db, id, parsed.events);
      recordFetchSuccess(db, id, at, parsed.skipped);
      return digestOf(listEventsOf(db, id)) !== before;
    })();
    logger.info(
      { sourceId: id, events: parsed.events.length, skipped: parsed.skipped, changed },
      'calendar fetched',
    );
    return changed;
  }

  /** Only the classification is kept and logged; the cause may quote the address. */
  function fail(id: number, at: Date, failure: FetchFailure): void {
    recordFetchFailure(db, id, at, failure);
    logger.warn({ sourceId: id, classification: failure }, 'calendar fetch failed');
  }

  return {
    listSources: () => listSources(db),
    getSource: (id) => getSource(db, id),

    async addSource(input) {
      const source = insertSource(db, input, now());
      await refresh(source.id);
      return getSource(db, source.id) ?? source;
    },

    async patchSource(id, patch) {
      const updated = db.transaction(() => {
        const source = updateSource(db, id, patch);
        if (source !== undefined && patch.url !== undefined) deleteEvents(db, id);
        return source;
      })();
      if (updated === undefined) return undefined;
      if (patch.url !== undefined) await refresh(id);
      return getSource(db, id);
    },

    deleteSource: (id) => deleteSource(db, id),

    async refreshSource(id) {
      if (getSource(db, id) === undefined) return undefined;
      if (await refresh(id)) broadcaster.publish('calendar');
      return getSource(db, id);
    },

    async refreshAll() {
      const ids = listSources(db).map((source) => source.id);
      // refresh() never rejects for a fetch problem, so a rejection here is a
      // bug (e.g. the database); allSettled still keeps it from stopping the others.
      const results = await Promise.allSettled(ids.map((id) => refresh(id)));
      let changed = false;
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error({ err: result.reason as unknown, sourceId: ids[index] }, 'calendar refresh failed');
        } else if (result.value) {
          changed = true;
        }
      });
      if (changed) broadcaster.publish('calendar');
    },

    eventsBetween(from, to) {
      const { start, end } = localDateRangeToInstants(from, to, zone);
      const sources = listSources(db);
      const successes = sources.flatMap((s) => (s.lastSuccessAt === null ? [] : [s.lastSuccessAt.getTime()]));
      return {
        events: listEventsBetween(db, { start, end, from, toExclusive: addDays(to, 1) }),
        sources,
        newestSuccessAt: successes.length === 0 ? null : new Date(Math.max(...successes)),
      };
    },
  };
}
