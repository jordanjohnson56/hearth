import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ServerFeature } from '../features/types.js';
import { testApp } from '../../test/helpers/app.js';
import { captureLogger } from '../../test/helpers/logger.js';
import { HttpError, jsonBody } from './http.js';

/** A test-only admin-style router: JSON bodies in, validation errors out. */
function choresWithJson(): ServerFeature {
  return {
    id: 'chores',
    name: 'Test chores',
    migrations: [],
    createRouter() {
      const router = Router();
      router.use(jsonBody);
      router.post('/echo', (req, res) => {
        res.json({ received: req.body as unknown });
      });
      router.get('/bad', () => {
        throw new HttpError(400, 'from must be a local date');
      });
      router.get('/upstream', () => {
        throw new HttpError(502, 'feed failed: https://cal.example/private-0123abcd/basic.ics');
      });
      return router;
    },
  };
}

describe('jsonBody', () => {
  it('parses a JSON body on a router that mounts it', async () => {
    const res = await request(testApp({ features: [choresWithJson()] }))
      .post('/api/chores/echo')
      .send({ label: 'Ada', color: 'ember' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: { label: 'Ada', color: 'ember' } });
  });

  it('refuses a body over the limit with a 413', async () => {
    const res = await request(testApp({ features: [choresWithJson()] }))
      .post('/api/chores/echo')
      .send({ label: 'x'.repeat(20_000) });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Payload Too Large' });
  });

  it('answers malformed JSON with a bare 400 that never echoes the body', async () => {
    const res = await request(testApp({ features: [choresWithJson()] }))
      .post('/api/chores/echo')
      .set('Content-Type', 'application/json')
      .send('{"url": "https://cal.example/private-0123abcd/basic.ics"');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request' });
    expect(res.text).not.toContain('private-0123abcd');
  });
});

describe('HttpError', () => {
  it('answers a 4xx with the reason phrase and the message, unlogged', async () => {
    const { logger, lines } = captureLogger();

    const res = await request(testApp({ features: [choresWithJson()], logger })).get(
      '/api/chores/bad',
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request', message: 'from must be a local date' });
    expect(lines()).toEqual([]);
  });

  it('keeps a 5xx bare and logs it with URLs redacted', async () => {
    const { logger, lines, text } = captureLogger();

    const res = await request(testApp({ features: [choresWithJson()], logger })).get(
      '/api/chores/upstream',
    );

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Bad Gateway' });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ path: '/api/chores/upstream', status: 502 });
    expect(text()).not.toContain('private-0123abcd');
  });

  it('is an Error with status and message', () => {
    const err = new HttpError(404, 'no such source');

    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.message).toBe('no such source');
    expect(err.name).toBe('HttpError');
  });
});
