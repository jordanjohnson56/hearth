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
