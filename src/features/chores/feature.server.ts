// The chores feature's server half: its tables and its router (mounted at
// /api/chores). M2.1 serves the chore definitions; the board, claims and
// corrections build on the same tables.
//
// Contract (status codes):
//   GET   /definitions      200 { chores } (archived included); 401 no bearer
//   POST  /definitions      201 chore; 400 bad field; 409 duplicate name; 401
//   PATCH /definitions/:id  200 chore; 400; 404; 409; 401
// Every write publishes a `chores` hint. Instants on the wire are epoch
// milliseconds, local dates YYYY-MM-DD (docs/adr/0004).
import { Router } from 'express';
import type { Request } from 'express';
import { localDate, parseLocalDate } from '../../core/time.js';
import type { LocalDate } from '../../core/time.js';
import { HttpError, bodyOf, jsonBody } from '../../server/http.js';
import type { FeatureContext, Migration, ServerFeature } from '../types.js';
import { DuplicateChoreNameError, insertChore, listChores, updateChore } from './choreRepository.js';
import type { Chore, ChorePatch } from './choreRepository.js';
import { parseRule } from './rule.js';
import type { RecurrenceRule } from './rule.js';
import type { ChoreWire, DefinitionsResponse } from './types.js';

export const MIN_POINTS = 1;
export const MAX_POINTS = 1000;

// The DDL needs a human's approval (M2 spec). Conventions: docs/adr/0002.
const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'create chore, completion and completion_void',
    sql: `
      -- A chore is archived, never deleted.
      CREATE TABLE chore (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL CHECK (name <> '' AND name = trim(name)),
        -- A recurrence rule as JSON text (docs/adr/0005). Its kinds are
        -- checked in code on every write and read; adding a kind needs no
        -- migration.
        rule        TEXT NOT NULL CHECK (rule <> ''),
        -- The current value; each completion keeps its own copy.
        points      INTEGER NOT NULL CHECK (points BETWEEN 1 AND 1000),
        -- The local date the rule counts from, in the configured zone.
        start_date  TEXT NOT NULL CHECK (date(start_date) IS start_date),
        archived_at INTEGER,
        created_at  INTEGER NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX chore_name ON chore (name COLLATE NOCASE);

      -- Append-only: a row is never updated or deleted. A mistaken one is
      -- voided with a completion_void row instead.
      CREATE TABLE completion (
        id             INTEGER PRIMARY KEY,
        chore_id       INTEGER NOT NULL REFERENCES chore (id),
        person_id      INTEGER NOT NULL REFERENCES person (id),
        -- The instant of the claim. After 2000-01-01, so a seconds value
        -- written by mistake is refused (ADR 0002).
        completed_at   INTEGER NOT NULL CHECK (completed_at > 946684800000),
        -- The chore's points at the moment of the claim.
        points_awarded INTEGER NOT NULL CHECK (points_awarded >= 1)
      ) STRICT;

      CREATE INDEX completion_completed_at ON completion (completed_at);
      CREATE INDEX completion_chore ON completion (chore_id, completed_at);

      -- At most one void per completion. undo: from the wall within the
      -- undo window; correction: an admin void or reassignment.
      CREATE TABLE completion_void (
        completion_id INTEGER PRIMARY KEY REFERENCES completion (id),
        voided_at     INTEGER NOT NULL CHECK (voided_at > 946684800000),
        reason        TEXT NOT NULL CHECK (reason IN ('undo', 'correction'))
      ) STRICT;
    `,
  },
];

function createRouter(ctx: FeatureContext): Router {
  const router = Router();
  const today = (): LocalDate => localDate(ctx.now(), ctx.config.zone);

  router.get('/definitions', ctx.requireAdmin, (_req, res) => {
    const body: DefinitionsResponse = { chores: listChores(ctx.db).map(toChoreWire) };
    res.json(body);
  });

  router.post('/definitions', ctx.requireAdmin, jsonBody, (req, res) => {
    const body = bodyOf(req.body);
    const input = {
      name: nameOf(body['name']),
      rule: ruleOf(body['rule']),
      points: pointsOf(body['points']),
      startDate: body['startDate'] === undefined ? today() : startDateOf(body['startDate']),
    };
    const chore = withDomainErrors(() => insertChore(ctx.db, input, ctx.now()));
    ctx.broadcaster.publish('chores');
    res.status(201).json(toChoreWire(chore));
  });

  router.patch('/definitions/:id', ctx.requireAdmin, jsonBody, (req, res) => {
    const id = idOf(req);
    const body = bodyOf(req.body);
    const patch: ChorePatch = {};
    if ('name' in body) patch.name = nameOf(body['name']);
    if ('rule' in body) patch.rule = ruleOf(body['rule']);
    if ('points' in body) patch.points = pointsOf(body['points']);
    if ('startDate' in body) patch.startDate = startDateOf(body['startDate']);
    if ('archived' in body) patch.archived = archivedOf(body['archived']);
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change');
    const chore = withDomainErrors(() => updateChore(ctx.db, id, patch, ctx.now()));
    if (chore === undefined) throw notFound();
    ctx.broadcaster.publish('chores');
    res.json(toChoreWire(chore));
  });

  return router;
}

export const choresServer = {
  id: 'chores',
  name: 'Chores',
  migrations,
  createRouter,
} satisfies ServerFeature;

// Validation. Every message is written for the admin form.

function idOf(req: Request): number {
  const raw = req.params['id'];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) throw notFound();
  return Number(raw);
}

function notFound(): HttpError {
  return new HttpError(404, 'No such chore');
}

function nameOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, 'Name is required');
  return value.trim();
}

function ruleOf(value: unknown): RecurrenceRule {
  const check = parseRule(value);
  if (!check.ok) throw new HttpError(400, check.message);
  return check.rule;
}

function pointsOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_POINTS || value > MAX_POINTS) {
    throw new HttpError(400, `Points must be a whole number from ${MIN_POINTS} to ${MAX_POINTS}`);
  }
  return value;
}

function startDateOf(value: unknown): LocalDate {
  const date = typeof value === 'string' ? parseLocalDate(value) : undefined;
  if (date === undefined) throw new HttpError(400, 'Start date must be a date as YYYY-MM-DD');
  return date;
}

function archivedOf(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, 'Archived must be true or false');
  return value;
}

function withDomainErrors<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof DuplicateChoreNameError) throw new HttpError(409, err.message);
    throw err;
  }
}

function toChoreWire(chore: Chore): ChoreWire {
  return {
    id: chore.id,
    name: chore.name,
    rule: chore.rule,
    points: chore.points,
    startDate: chore.startDate,
    archivedAt: chore.archivedAt?.getTime() ?? null,
    createdAt: chore.createdAt.getTime(),
  };
}
