import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ServerFeature } from '../features/types.js';
import { createApp } from './app.js';

const clientDist = fileURLToPath(
  new URL('../../test/fixtures/client-dist', import.meta.url),
);

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
    const app = createApp({ clientDist, features: [choresWithPing()] });

    const res = await request(app).get('/api/chores/ping');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  it('answers a path the feature router does not handle with a JSON 404', async () => {
    const app = createApp({ clientDist, features: [choresWithPing()] });

    const res = await request(app).get('/api/chores/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('does not mount one feature router under another feature id', async () => {
    const app = createApp({ clientDist, features: [choresWithPing()] });

    const res = await request(app).get('/api/calendar/ping');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('turns an error thrown in a feature router into a bare JSON 500', async () => {
    const app = createApp({ clientDist, features: [choresWithPing()] });
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => {
      silenced.mockRestore();
    });

    const res = await request(app).get('/api/chores/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(res.text).not.toContain('/secret/path');
  });

  it('mounts no feature routes for the registered stubs', async () => {
    const res = await request(createApp({ clientDist })).get('/api/chores');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });
});
