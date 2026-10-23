import { STATUS_CODES } from 'node:http';
import express from 'express';
import type { ErrorRequestHandler, Express, Response } from 'express';
import { serverFeatureList } from '../features/registry.server.js';
import type { ServerFeature } from '../features/types.js';

export interface AppOptions {
  /** Directory holding the built client (index.html plus assets). */
  clientDist: string;
  /** Features to mount. Defaults to the server registry; tests pass their own. */
  features?: readonly ServerFeature[];
}

/** Builds the Hearth HTTP app. Does not listen; the entrypoint does. */
export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');

  for (const feature of options.features ?? serverFeatureList) {
    if (feature.router) app.use(`/api/${feature.id}`, feature.router);
  }

  // Anything under /api that reached here is unknown: JSON, never the SPA.
  app.use('/api', (_req, res) => {
    sendError(res, 404);
  });

  app.use(express.static(options.clientDist));

  // SPA fallback: every other GET is a client-side route.
  app.get('/{*path}', (_req, res, next) => {
    res.sendFile('index.html', { root: options.clientDist }, (err) => {
      if (err) next(err);
    });
  });

  app.use(errorBoundary);

  return app;
}

/**
 * The HTTP error boundary. Responds with the status's reason phrase only:
 * never the error's own message (it may carry a URL or a path) and never a
 * stack trace.
 */
const errorBoundary: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = httpStatusOf(err);
  if (status >= 500) {
    // Replaced by the structured logger in M0.3.
    console.error(err);
  }
  sendError(res, status);
};

function httpStatusOf(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const candidate =
      ('status' in err ? err.status : undefined) ??
      ('statusCode' in err ? err.statusCode : undefined);
    if (
      typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= 400 &&
      candidate <= 599
    ) {
      return candidate;
    }
  }
  return 500;
}

function sendError(res: Response, status: number): void {
  res.status(status).json({ error: STATUS_CODES[status] ?? 'Error' });
}
