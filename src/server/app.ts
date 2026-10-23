import { readFile } from 'node:fs/promises';
import { STATUS_CODES } from 'node:http';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import express from 'express';
import type { ErrorRequestHandler, Express, RequestHandler, Response } from 'express';
import { serverFeatureList } from '../features/registry.server.js';
import type { FeatureContext, FeatureJob, ServerFeature } from '../features/types.js';
import { createBroadcaster } from './broadcaster.js';
import type { Broadcaster } from './broadcaster.js';
import type { Config } from './config.js';
import { eventsHandler } from './events.js';
import { HttpError } from './http.js';
import { injectZone } from './index-html.js';
import type { Logger } from './logger.js';

export interface AppOptions {
  /** Directory holding the built client (index.html plus assets). */
  clientDist: string;
  /** Validated bootstrap config; the app never reads process.env. */
  config: Config;
  logger: Logger;
  /** The migrated database; feature routers and jobs read and write it. */
  db: Database;
  /** Features to mount. Defaults to the server registry; tests pass their own. */
  features?: readonly ServerFeature[];
  /** The clock features see. Defaults to the real one; tests inject a fixed one. */
  now?: () => Date;
  /** Outbound HTTP for features. Defaults to the global fetch; tests inject fixtures. */
  fetch?: typeof globalThis.fetch;
  /**
   * The admin gate handed to features. Defaults to a placeholder that refuses
   * everything with a 401 until core's bearer-token middleware exists.
   */
  requireAdmin?: RequestHandler;
  /**
   * Live-update hub behind GET /api/events. The entrypoint passes the one it
   * hands to jobs and writers; defaults to a private one nothing publishes to.
   */
  broadcaster?: Broadcaster;
}

export interface CreatedApp {
  app: Express;
  /** Every feature's job, in registry order, for the entrypoint's scheduler. */
  jobs: readonly FeatureJob[];
}

/**
 * Builds the Hearth HTTP app and each feature's job. Does not listen or run
 * the jobs; the entrypoint does, after the database is migrated.
 */
export function createApp(options: AppOptions): CreatedApp {
  const app = express();
  app.disable('x-powered-by');

  const broadcaster = options.broadcaster ?? createBroadcaster(options.logger);
  const ctx: FeatureContext = {
    db: options.db,
    broadcaster,
    logger: options.logger,
    config: options.config,
    now: options.now ?? (() => new Date()),
    fetch: options.fetch ?? globalThis.fetch,
    requireAdmin: options.requireAdmin ?? placeholderRequireAdmin,
  };

  const jobs: FeatureJob[] = [];
  for (const feature of options.features ?? serverFeatureList) {
    if (feature.createRouter) app.use(`/api/${feature.id}`, feature.createRouter(ctx));
    if (feature.createJob) jobs.push(feature.createJob(ctx));
  }

  app.get('/api/events', eventsHandler(broadcaster));

  // Anything under /api that reached here is unknown: JSON, never the SPA.
  app.use('/api', (_req, res) => {
    sendError(res, 404);
  });

  // index.html always goes through sendIndex (zone injected), never raw
  // from express.static: hence `index: false` and the explicit route.
  const sendIndex = indexHandler(options.clientDist, options.config.zone);
  app.get('/index.html', sendIndex);
  app.use(express.static(options.clientDist, { index: false }));

  // A file express.static did not find is missing, not a client route: a
  // stale /assets/index-OLDHASH.js must 404, or the browser runs index.html
  // as a script.
  app.get('/{*path}', (req, res, next) => {
    if (looksLikeFile(req.path)) sendError(res, 404);
    else next();
  });

  // SPA fallback: every other GET is a client-side route.
  app.get('/{*path}', sendIndex);

  app.use(errorBoundary(options.logger));

  return { app, jobs };
}

/** Stands in for the admin gate until core has one: nobody is an admin. */
const placeholderRequireAdmin: RequestHandler = (_req, res) => {
  sendError(res, 401);
};

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

/**
 * True for a path under /assets/ (Vite's build output) or whose last segment
 * has a file extension (`/favicon.ico`). Client routes have neither.
 */
function looksLikeFile(path: string): boolean {
  if (path === '/assets' || path.startsWith('/assets/')) return true;
  const last = path.slice(path.lastIndexOf('/') + 1);
  return /\.[a-z0-9]+$/i.test(last);
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
 * The HTTP error boundary, the only place an error becomes a response. It
 * answers with the status's reason phrase, plus the message when the error
 * is a 4xx HttpError (a message written for the client). Any other error's
 * message stays out of the response (it may carry a URL, a path or an echo
 * of the request body), and there is never a stack trace. A 5xx is logged
 * by method and path: never the query string (`req.path` has none) and
 * never the body, since either could carry an iCal URL. The logger's `err`
 * serializer redacts URLs in the message.
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
      sendError(res, status);
    } else if (err instanceof HttpError) {
      sendError(res, status, err.message);
    } else {
      sendError(res, status);
    }
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

function sendError(res: Response, status: number, message?: string): void {
  const error = STATUS_CODES[status] ?? 'Error';
  res.status(status).json(message === undefined ? { error } : { error, message });
}
