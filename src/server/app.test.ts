import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it, onTestFinished } from 'vitest';
import { testAppOptions } from '../../test/helpers/app.js';
import { captureLogger } from '../../test/helpers/logger.js';
import { createApp } from './app.js';

describe('app factory', () => {
  it('serves the SPA index.html for the root path', async () => {
    const res = await request(createApp(testAppOptions())).get('/');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('hearth-fixture-index');
  });

  it('serves the SPA index.html for a non-API client route', async () => {
    const res = await request(createApp(testAppOptions())).get('/chores/week');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('hearth-fixture-index');
  });

  it.each(['/calendar/2026/10', '/chores/week/2026-10-19', '/v1.2/settings'])(
    'serves the SPA index.html for client route %s',
    async (path) => {
      const res = await request(createApp(testAppOptions())).get(path);

      expect(res.status).toBe(200);
      expect(res.text).toContain('hearth-fixture-index');
    },
  );

  it.each([
    '/assets/index-OLDHASH.js',
    '/assets/no-extension',
    '/assets/',
    '/favicon.ico',
    '/robots.txt',
    '/calendar/manifest.webmanifest',
  ])('answers missing static file %s with a 404, not index.html', async (path) => {
    const res = await request(createApp(testAppOptions())).get(path);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('hearth-fixture-index');
  });

  it.each(['/api/nope', '/api', '/api/calendar/events/7'])(
    'answers unknown API path %s with a JSON 404 and no stack trace',
    async (path) => {
      const res = await request(createApp(testAppOptions())).get(path);

      expect(res.status).toBe(404);
      expect(res.type).toBe('application/json');
      expect(res.body).toEqual({ error: 'Not Found' });
      expect(res.text).not.toMatch(/\bat\s.+:\d+:\d+/);
    },
  );

  it('answers a malformed request with a JSON 4xx and no stack trace', async () => {
    // A broken percent-escape makes Express fail while decoding the path.
    const res = await request(createApp(testAppOptions())).get('/%E0%A4%A');

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

    const res = await request(createApp(testAppOptions({ clientDist: emptyDist }))).get('/');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
    expect(res.text).not.toContain(emptyDist);
  });

  it('answers an unknown API path with a JSON 404 for non-GET methods too', async () => {
    const res = await request(createApp(testAppOptions())).post('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('logs a 5xx by method and path only, never the query string or body', async () => {
    // index.html is a directory, so the SPA fallback fails with a 500.
    const brokenDist = mkdtempSync(join(tmpdir(), 'hearth-broken-client-'));
    onTestFinished(() => {
      rmSync(brokenDist, { recursive: true, force: true });
    });
    mkdirSync(join(brokenDist, 'index.html'));
    const { logger, lines, text } = captureLogger();
    const secret = 'https://cal.example/private-0123abcd/basic.ics';

    const res = await request(createApp(testAppOptions({ clientDist: brokenDist, logger })))
      .get(`/admin/calendars?source=${encodeURIComponent(secret)}`)
      .send({ url: secret });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      level: 50,
      method: 'GET',
      path: '/admin/calendars',
      status: 500,
      err: { code: 'EISDIR' },
    });
    expect(text()).not.toContain('private-0123abcd');
    expect(text()).not.toContain('source=');
    expect(text()).not.toContain(brokenDist);
  });

  it('does not log 4xx responses', async () => {
    const { logger, lines } = captureLogger();

    await request(createApp(testAppOptions({ logger }))).get('/api/nope');

    expect(lines()).toEqual([]);
  });
});
