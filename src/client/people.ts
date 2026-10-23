// The client side of the core people API (src/server/people.ts).
import type { PeopleResponse } from '../core/person.js';
import { readJson } from './http.js';

/** GET /api/people: everyone, in creation order. Public, no bearer. */
export async function fetchPeople(signal: AbortSignal): Promise<PeopleResponse> {
  const res = await fetch('/api/people', { signal });
  if (!res.ok) throw new Error(`Could not load people (${String(res.status)})`);
  return readJson<PeopleResponse>(res);
}
