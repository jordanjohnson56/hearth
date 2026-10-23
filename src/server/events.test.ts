import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import request from 'supertest';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testAppOptions } from '../../test/helpers/app.js';
import { captureLogger } from '../../test/helpers/logger.js';
import { createApp } from './app.js';
import { createBroadcaster } from './broadcaster.js';
import type { Broadcaster } from './broadcaster.js';
import { KEEPALIVE_INTERVAL_MS } from './events.js';

interface OpenStream {
  status: number;
  headers: IncomingHttpHeaders;
  /** The first chunk of the body, sent as soon as the stream opens. */
  opening: string;
  /** Resolves with the next chunk of the body after `opening`, as text. */
  nextChunk: () => Promise<string>;
  /** Drops the connection, as a sleeping iPad would. */
  abort: () => void;
}

/**
 * Opens GET /api/events and resolves once the opening chunk arrives. The
 * stream never ends on its own, so the test reads chunks and then aborts.
 */
async function openEventStream(broadcaster: Broadcaster): Promise<OpenStream> {
  const app = createApp(testAppOptions({ broadcaster }));
  const req = request(app).get('/api/events').buffer(false);

  // Queue chunks as they arrive, so none is lost between reads.
  const arrived: string[] = [];
  const waiting: ((chunk: string) => void)[] = [];
  const nextChunk = (): Promise<string> =>
    new Promise((resolve) => {
      const text = arrived.shift();
      if (text === undefined) waiting.push(resolve);
      else resolve(text);
    });

  const response = new Promise<IncomingMessage>((resolve) => {
    // Under Node, superagent hands a custom parser the raw IncomingMessage
    // (its typings only offer a union of browser and Node shapes). Listen
    // here, synchronously: the stream is already flowing by the time an
    // awaiting caller resumes, and the opening chunk would be lost.
    req.parse((raw: unknown) => {
      const res = raw as IncomingMessage;
      res.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const reader = waiting.shift();
        if (reader) reader(text);
        else arrived.push(text);
      });
      resolve(res);
    });
  });
  // Starts the request. The stream never completes, so nothing waits on it.
  req.end(() => undefined);
  const res = await response;
  const abort = (): void => {
    res.destroy();
  };
  onTestFinished(abort);

  return {
    status: res.statusCode ?? 0,
    headers: res.headers,
    opening: await nextChunk(),
    nextChunk,
    abort,
  };
}

describe('GET /api/events', () => {
  it('opens with a comment line, so a proxy forwards the headers at once', async () => {
    const stream = await openEventStream(createBroadcaster(captureLogger().logger));

    expect(stream.opening).toBe(': connected\n\n');
  });

  it('streams a published change hint as an SSE message', async () => {
    const broadcaster = createBroadcaster(captureLogger().logger);
    const stream = await openEventStream(broadcaster);

    const chunk = stream.nextChunk();
    broadcaster.publish('chores');

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(stream.headers['cache-control']).toContain('no-cache');
    expect(stream.headers['x-accel-buffering']).toBe('no');
    expect(await chunk).toBe('data: {"feature":"chores"}\n\n');
  });

  it('drops the subscriber when the client disconnects', async () => {
    const broadcaster = createBroadcaster(captureLogger().logger);
    const stream = await openEventStream(broadcaster);
    expect(broadcaster.subscriberCount).toBe(1);

    stream.abort();

    await vi.waitFor(() => {
      expect(broadcaster.subscriberCount).toBe(0);
    });
  });

  it('sends every open stream the same hint', async () => {
    const broadcaster = createBroadcaster(captureLogger().logger);
    const first = await openEventStream(broadcaster);
    const second = await openEventStream(broadcaster);

    const chunks = Promise.all([first.nextChunk(), second.nextChunk()]);
    broadcaster.publish('calendar');

    expect(await chunks).toEqual([
      'data: {"feature":"calendar"}\n\n',
      'data: {"feature":"calendar"}\n\n',
    ]);
  });

  it('still streams a hint when another subscriber throws', async () => {
    const broadcaster = createBroadcaster(captureLogger().logger);
    broadcaster.subscribe(() => {
      throw new Error('write after end');
    });
    const stream = await openEventStream(broadcaster);

    const chunk = stream.nextChunk();
    broadcaster.publish('chores');

    expect(await chunk).toBe('data: {"feature":"chores"}\n\n');
    expect(broadcaster.subscriberCount).toBe(1);
  });

  it('sends a keepalive comment on a quiet stream and stops after disconnect', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const broadcaster = createBroadcaster(captureLogger().logger);
    const stream = await openEventStream(broadcaster);

    const chunk = stream.nextChunk();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);

    expect(await chunk).toBe(': keepalive\n\n');

    stream.abort();
    await vi.waitFor(() => {
      expect(broadcaster.subscriberCount).toBe(0);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
