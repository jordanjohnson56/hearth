import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { FeatureContext, FeatureId, ServerFeature } from '../features/types.js';
import { testApp, testAppOptions } from '../../test/helpers/app.js';
import { captureLogger } from '../../test/helpers/logger.js';
import { createApp } from './app.js';
import { createBroadcaster } from './broadcaster.js';
import { upsertPersonByDisplayName } from './db/personRepository.js';

/** A test-only feature; the registered stubs have no router yet. */
function choresWithPing(): ServerFeature {
  return {
    id: 'chores',
    name: 'Test chores',
    migrations: [],
    createRouter() {
      const router = Router();
      router.get('/ping', (_req, res) => {
        res.json({ pong: true });
      });
      router.get('/boom', () => {
        throw new Error('boom at /secret/path');
      });
      return router;
    },
  };
}

/** A feature whose router and job use everything the context carries. */
function choresUsingContext(): ServerFeature {
  return {
    id: 'chores',
    name: 'Test chores',
    migrations: [
      {
        id: 1,
        name: 'create note',
        sql: `CREATE TABLE chores_note (text TEXT NOT NULL) STRICT;
              INSERT INTO chores_note (text) VALUES ('from migration');`,
      },
    ],
    createRouter(ctx: FeatureContext) {
      const router = Router();
      router.get('/people', (_req, res) => {
        const names = ctx.db
          .prepare('SELECT display_name AS name FROM person ORDER BY id')
          .pluck()
          .all();
        res.json({ names });
      });
      router.get('/notes', (_req, res) => {
        res.json({ notes: ctx.db.prepare('SELECT text FROM chores_note').pluck().all() });
      });
      router.get('/now', (_req, res) => {
        res.json({ now: ctx.now().toISOString(), zone: ctx.config.zone });
      });
      router.get('/remote', async (_req, res) => {
        const upstream = await ctx.fetch('https://cal.example/feed');
        res.json({ status: upstream.status, body: await upstream.text() });
      });
      router.get('/locked', ctx.requireAdmin, (_req, res) => {
        res.json({ secret: true });
      });
      router.get('/log', (_req, res) => {
        ctx.logger.info({ feature: 'chores' }, 'router says hello');
        res.json({ ok: true });
      });
      return router;
    },
    createJob(ctx: FeatureContext) {
      return {
        name: 'chores poll',
        intervalMs: 60_000,
        run: async () => {
          ctx.broadcaster.publish('chores');
          await Promise.resolve();
        },
      };
    },
  };
}

describe('feature routers', () => {
  it('mounts a feature router under /api/<id>', async () => {
    const res = await request(testApp({ features: [choresWithPing()] })).get('/api/chores/ping');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  it('answers a path the feature router does not handle with a JSON 404', async () => {
    const res = await request(testApp({ features: [choresWithPing()] })).get('/api/chores/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('does not mount one feature router under another feature id', async () => {
    const res = await request(testApp({ features: [choresWithPing()] })).get('/api/calendar/ping');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('turns an error thrown in a feature router into a bare JSON 500', async () => {
    const { logger, lines } = captureLogger();
    const app = testApp({ features: [choresWithPing()], logger });

    const res = await request(app).get('/api/chores/boom?q=1');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(res.text).not.toContain('/secret/path');
    // Logged with the full mounted path, without the query string.
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ method: 'GET', path: '/api/chores/boom', status: 500 });
  });

  it('mounts no feature routes for the registered stubs', async () => {
    const res = await request(testApp()).get('/api/chores');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });
});

describe('feature context', () => {
  it('hands the router the database the app serves', async () => {
    const options = testAppOptions({ features: [choresUsingContext()] });
    upsertPersonByDisplayName(options.db, { displayName: 'Ada', color: 'ember' });

    const res = await request(createApp(options).app).get('/api/chores/people');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ names: ['Ada'] });
  });

  it("builds the router after the feature's own migrations have run", async () => {
    const res = await request(testApp({ features: [choresUsingContext()] })).get(
      '/api/chores/notes',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notes: ['from migration'] });
  });

  it('hands the router the injected clock and the config', async () => {
    const app = testApp({
      features: [choresUsingContext()],
      now: () => new Date('2026-10-23T12:34:56Z'),
    });

    const res = await request(app).get('/api/chores/now');

    expect(res.body).toEqual({ now: '2026-10-23T12:34:56.000Z', zone: 'America/Chicago' });
  });

  it('hands the router the injected fetch', async () => {
    const fetch: typeof globalThis.fetch = () =>
      Promise.resolve(new Response('fixture feed', { status: 200 }));
    const app = testApp({ features: [choresUsingContext()], fetch });

    const res = await request(app).get('/api/chores/remote');

    expect(res.body).toEqual({ status: 200, body: 'fixture feed' });
  });

  it('hands the router the app logger', async () => {
    const { logger, lines } = captureLogger();
    const app = testApp({ features: [choresUsingContext()], logger });

    await request(app).get('/api/chores/log');

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ feature: 'chores', msg: 'router says hello' });
  });

  it('refuses a route behind the placeholder requireAdmin with a JSON 401', async () => {
    const res = await request(testApp({ features: [choresUsingContext()] })).get(
      '/api/chores/locked',
    );

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('uses an injected requireAdmin in place of the placeholder', async () => {
    const app = testApp({
      features: [choresUsingContext()],
      requireAdmin: (_req, _res, next) => {
        next();
      },
    });

    const res = await request(app).get('/api/chores/locked');

    expect(res.body).toEqual({ secret: true });
  });

  it("returns each feature's job, built with a broadcaster the job can publish to", async () => {
    const broadcaster = createBroadcaster(captureLogger().logger);
    const hints: FeatureId[] = [];
    broadcaster.subscribe((feature) => hints.push(feature));
    const { jobs } = createApp(testAppOptions({ features: [choresUsingContext()], broadcaster }));

    expect(jobs.map((job) => job.name)).toEqual(['chores poll']);
    await jobs[0]?.run();

    expect(hints).toEqual(['chores']);
  });

  it('returns no jobs for features without one', () => {
    const { jobs } = createApp(testAppOptions({ features: [choresWithPing()] }));

    expect(jobs).toEqual([]);
  });
});
