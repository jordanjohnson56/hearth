// Core people routes, mounted by the app factory at /api/people, over the
// person repository. A person edit publishes no change hint: the wall picks
// people up from the chores board response and the 5-minute backstop.
//
// Contract (status codes):
//   GET   /      200 { people } in creation order; public
//   POST  /      201 person; 400 bad name or color; 409 name taken
//                (ignoring case); 401 no bearer
//   PATCH /:id   200 person (name and/or color); 400; 404; 409; 401
import type { Database } from 'better-sqlite3';
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { PeopleResponse, PersonWire } from '../core/person.js';
import { isPersonColor } from '../core/personColor.js';
import type { PersonColor } from '../core/personColor.js';
import { DuplicateDisplayNameError, insertPerson, listPeople, updatePerson } from './db/personRepository.js';
import type { Person, PersonPatch } from './db/personRepository.js';
import { HttpError, bodyOf, jsonBody } from './http.js';

export interface PeopleRouterOptions {
  db: Database;
  /** The admin's bearer gate; every write goes through it. */
  requireAdmin: RequestHandler;
}

export function createPeopleRouter(options: PeopleRouterOptions): Router {
  const { db, requireAdmin } = options;
  const router = Router();

  router.get('/', (_req, res) => {
    const body: PeopleResponse = { people: listPeople(db).map(toPersonWire) };
    res.json(body);
  });

  router.post('/', requireAdmin, jsonBody, (req, res) => {
    const body = bodyOf(req.body);
    const input = { displayName: displayNameOf(body.displayName), color: colorOf(body.color) };
    const person = withNameConflict(() => insertPerson(db, input));
    res.status(201).json(toPersonWire(person));
  });

  router.patch('/:id', requireAdmin, jsonBody, (req, res) => {
    const id = idOf(req);
    const body = bodyOf(req.body);
    const patch: PersonPatch = {};
    if ('displayName' in body) patch.displayName = displayNameOf(body.displayName);
    if ('color' in body) patch.color = colorOf(body.color);
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change');
    const person = withNameConflict(() => updatePerson(db, id, patch));
    if (person === undefined) throw notFound();
    res.json(toPersonWire(person));
  });

  return router;
}

export function toPersonWire(person: Person): PersonWire {
  return { id: person.id, displayName: person.displayName, color: person.color, icon: person.icon };
}

/** A taken name is the client's to fix: a 409 with the repository's message. */
function withNameConflict<T>(write: () => T): T {
  try {
    return write();
  } catch (err) {
    if (err instanceof DuplicateDisplayNameError) throw new HttpError(409, err.message);
    throw err;
  }
}

// Validation. Every message is written for the client and names the field.

function idOf(req: Request): number {
  const raw = req.params['id'];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) throw notFound();
  return Number(raw);
}

function notFound(): HttpError {
  return new HttpError(404, 'No such person');
}

/** A display name as sent: non-empty and already trimmed (never trimmed here). */
function displayNameOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, 'Name is required');
  if (value !== value.trim()) throw new HttpError(400, 'Name must not start or end with a space');
  return value;
}

function colorOf(value: unknown): PersonColor {
  if (typeof value !== 'string' || !isPersonColor(value)) {
    throw new HttpError(400, 'Color must be one of the palette colors');
  }
  return value;
}
