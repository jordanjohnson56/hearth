import { readJson } from '../../client/http.js';
import type { EventsResponse } from './types.js';

/** GET /api/calendar/events for the inclusive local dates `from` through `to` (at most 92). */
export async function fetchEvents(from: string, to: string, signal: AbortSignal): Promise<EventsResponse> {
  const query = new URLSearchParams({ from, to });
  const res = await fetch(`/api/calendar/events?${query.toString()}`, { signal });
  if (!res.ok) throw new Error(`Could not load the calendar (${String(res.status)})`);
  return readJson<EventsResponse>(res);
}
