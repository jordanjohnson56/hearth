import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ServerFeature } from '../features/types.js';
import { testAppOptions } from '../../test/helpers/app.js';
import { captureLogger } from '../../test/helpers/logger.js';
import { createApp } from './app.js';

/** A test-only feature; the registered stubs have no router yet. */
function choresWithPing(): ServerFeature {
  const router = Router();
  router.get('/ping', (_req, res) => {
    res.json({ pong: true });
  });
  router.get('/boom', () => {
    throw new Error('boom at /secret/path');
  });
  return { id: 'chores', name: 'Test chores', migrations: [], router };
}

describe('feature routers', () => {
  it('mounts a feature router under /api/<id>', async () => {
    const app = createApp(testAppOptions({ features: [choresWithPing()] }));

    const res = await request(app).get('/api/chores/ping');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  it('answers a path the feature router does not handle with a JSON 404', async () => {
    const app = createApp(testAppOptions({ features: [choresWithPing()] }));

    const res = await request(app).get('/api/chores/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('does not mount one feature router under another feature id', async () => {
    const app = createApp(testAppOptions({ features: [choresWithPing()] }));

    const res = await request(app).get('/api/calendar/ping');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('turns an error thrown in a feature router into a bare JSON 500', async () => {
    const { logger, lines } = captureLogger();
    const app = createApp(testAppOptions({ features: [choresWithPing()], logger }));

    const res = await request(app).get('/api/chores/boom?q=1');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(res.text).not.toContain('/secret/path');
    // Logged with the full mounted path, without the query string.
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ method: 'GET', path: '/api/chores/boom', status: 500 });
  });

  it('mounts no feature routes for the registered stubs', async () => {
    const res = await request(createApp(testAppOptions())).get('/api/chores');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });
});
