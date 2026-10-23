import { pino } from 'pino';
import type { DestinationStream, LevelWithSilent, Logger, LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/** Every level LOG_LEVEL accepts, most severe first. `silent` logs nothing. */
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const satisfies readonly LevelWithSilent[];

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Builds the structured (JSON lines) logger. Writes to stdout unless a
 * destination is given (tests pass one to capture lines).
 *
 * Errors logged under `err` go through a serializer that keeps only the
 * error's name, code and message, with every URL in the message cut down to
 * its scheme and host: an iCal secret address is a bearer credential and must
 * never reach a log line (DESIGN.md section 3). Stacks are left out for the
 * same reason, since a stack's first line repeats the message.
 *
 * Never log request bodies or full request/outbound URLs. Log a request by
 * method and path, and a calendar source by its label or id.
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level,
    // No pid or hostname on every line.
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: serializeError },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

interface SerializedError {
  type: string;
  message: string;
  code?: string;
}

function serializeError(err: unknown): SerializedError {
  if (!(err instanceof Error)) {
    return { type: typeof err, message: '[non-error value]' };
  }
  const serialized: SerializedError = {
    type: err.name,
    message: redactUrls(err.message),
  };
  const code: unknown = (err as { code?: unknown }).code;
  if (typeof code === 'string') serialized.code = code;
  return serialized;
}

const URL_PATTERN = /\b([a-z][a-z0-9+.-]*):\/\/([^/?#\s'"<>]*)[^\s'"<>]*/gi;

/**
 * Replaces every absolute URL in `text` with its scheme and host only, so
 * path, query and fragment (where calendar secrets live) are dropped.
 * Credentials before an `@` in the authority are dropped too.
 */
export function redactUrls(text: string): string {
  return text.replace(URL_PATTERN, (_match, scheme: string, authority: string) => {
    const host = authority.slice(authority.lastIndexOf('@') + 1);
    return `${scheme}://${host}/[redacted]`;
  });
}
