import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createApp } from './app.js';

const clientDist = fileURLToPath(
  new URL('../../test/fixtures/client-dist', import.meta.url),
);

describe('app factory', () => {
  it('serves the SPA index.html for the root path', async () => {
    const res = await request(createApp({ clientDist })).get('/');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('hearth-fixture-index');
  });

  it('serves the SPA index.html for a non-API client route', async () => {
    const res = await request(createApp({ clientDist })).get('/chores/week');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('hearth-fixture-index');
  });

  it.each(['/api/nope', '/api', '/api/calendar/events/7'])(
    'answers unknown API path %s with a JSON 404 and no stack trace',
    async (path) => {
      const res = await request(createApp({ clientDist })).get(path);

      expect(res.status).toBe(404);
      expect(res.type).toBe('application/json');
      expect(res.body).toEqual({ error: 'Not Found' });
      expect(res.text).not.toMatch(/\bat\s.+:\d+:\d+/);
    },
  );

  it('answers a malformed request with a JSON 4xx and no stack trace', async () => {
    // A broken percent-escape makes Express fail while decoding the path.
    const res = await request(createApp({ clientDist })).get('/%E0%A4%A');

    expect(res.status).toBe(400);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: 'Bad Request' });
    expect(res.text).not.toMatch(/\bat\s.+:\d+:\d+/);
  });

  it('answers with a JSON 404, not a crash, when the client is not built', async () => {
    const emptyDist = mkdtempSync(join(tmpdir(), 'hearth-no-client-'));
    onTestFinished(() => {
      rmSync(emptyDist, { recursive: true, force: true });
    });

    const res = await request(createApp({ clientDist: emptyDist })).get('/');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
    expect(res.text).not.toContain(emptyDist);
  });

  it('answers an unknown API path with a JSON 404 for non-GET methods too', async () => {
    const res = await request(createApp({ clientDist })).post('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });
});
