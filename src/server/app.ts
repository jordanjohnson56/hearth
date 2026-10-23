import { readFile } from 'node:fs/promises';
import { STATUS_CODES } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import type { ErrorRequestHandler, Express, RequestHandler, Response } from 'express';
import { serverFeatureList } from '../features/registry.server.js';
import type { ServerFeature } from '../features/types.js';
import type { Config } from './config.js';
import { injectZone } from './index-html.js';
import type { Logger } from './logger.js';

export interface AppOptions {
  /** Directory holding the built client (index.html plus assets). */
  clientDist: string;
  /** Validated bootstrap config; the app never reads process.env. */
  config: Config;
  logger: Logger;
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

  // index.html always goes through sendIndex (zone injected), never raw
  // from express.static: hence `index: false` and the explicit route.
  const sendIndex = indexHandler(options.clientDist, options.config.zone);
  app.get('/index.html', sendIndex);
  app.use(express.static(options.clientDist, { index: false }));

  // SPA fallback: every other GET is a client-side route.
  app.get('/{*path}', sendIndex);

  app.use(errorBoundary(options.logger));

  return app;
}

/**
 * Serves the client's index.html with the configured zone injected. Read per
 * request (it is small) so a rebuilt client needs no restart. A missing
 * build is a 404, like any other missing file.
 */
function indexHandler(clientDist: string, zone: string): RequestHandler {
  return async (_req, res) => {
    let html: string;
    try {
      html = await readFile(join(clientDist, 'index.html'), 'utf8');
    } catch (err) {
      throw isMissingFile(err) ? Object.assign(new Error('client not built'), { status: 404 }) : err;
    }
    res.type('html').set('Cache-Control', 'no-cache').send(injectZone(html, zone));
  };
}

function isMissingFile(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err.code === 'ENOENT' || err.code === 'ENOTDIR')
  );
}

/**
 * The HTTP error boundary. Responds with the status's reason phrase only:
 * never the error's own message (it may carry a URL or a path) and never a
 * stack trace. A 5xx is logged by method and path: never the query string
 * (`req.path` has none) and never the body, since either could carry an
 * iCal URL. The logger's `err` serializer redacts URLs in the message.
 */
function errorBoundary(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = httpStatusOf(err);
    if (status >= 500) {
      logger.error({ err, method: req.method, path: req.path, status }, 'request failed');
    }
    sendError(res, status);
  };
}

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
