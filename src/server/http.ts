// HTTP helpers shared by core and feature routers.
import express from 'express';
import type { RequestHandler } from 'express';

/**
 * JSON body parsing for admin routers (`router.use(jsonBody)`). Mounted per
 * router, not app-wide: the public routes take no body. The limit is small
 * because every admin body is a few fields; a body over it is a 413.
 */
export const jsonBody: RequestHandler = express.json({ limit: '16kb' });

/**
 * An error whose message is safe to send to the client. Throw one for bad
 * input: the error boundary answers `{ error: <reason phrase>, message }`
 * for a 4xx. Keep the message free of anything the client did not already
 * send, and never put a URL in it: a 5xx is answered bare but logged, and
 * only the logger's own serializer stands between the message and the log.
 */
export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * A 4xx answered with the reason phrase alone, for the case where there is
 * nothing to tell the client: a request without a live admin token, whose
 * only remedy is to unlock, which the client already knows. The message is
 * for a log line, never for the response. HttpError and this class are the
 * whole vocabulary of errors a route throws on purpose.
 */
export class BareHttpError extends Error {
  override name = 'BareHttpError';
  readonly status: number;

  constructor(status: number, reason: string) {
    super(reason);
    this.status = status;
  }
}

/** The parsed JSON body as a bag of unknowns; a non-object body is an empty bag. */
export function bodyOf(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}
