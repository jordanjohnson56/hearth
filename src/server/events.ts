import type { RequestHandler } from 'express';
import { encodeChangeHint } from '../core/changeHint.js';
import type { Broadcaster } from './broadcaster.js';

/**
 * How often an idle event stream sends a comment line. Keeps proxies and
 * the browser from timing out a quiet connection, and lets the server notice
 * a dead one.
 */
export const KEEPALIVE_INTERVAL_MS = 25_000;

/**
 * GET /api/events: a Server-Sent Events stream of change hints. Each message
 * is `data: {"feature":"<id>"}`. The stream stays open until the client
 * leaves, at which point it unsubscribes.
 */
export function eventsHandler(broadcaster: Broadcaster): RequestHandler {
  return (req, res) => {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells a reverse proxy (nginx and friends) not to buffer the stream.
      'X-Accel-Buffering': 'no',
    });
    // A body byte straight away: some proxies (Vite's dev proxy among them)
    // hold the response headers until the first one, which would leave the
    // browser's EventSource connecting until the first keepalive.
    res.write(': connected\n\n');

    const unsubscribe = broadcaster.subscribe((feature) => {
      // The socket can be gone before 'close' has unsubscribed us.
      if (res.writableEnded || res.destroyed) {
        unsubscribe();
        return;
      }
      res.write(`data: ${encodeChangeHint(feature)}\n\n`);
    });
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, KEEPALIVE_INTERVAL_MS);

    req.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  };
}
