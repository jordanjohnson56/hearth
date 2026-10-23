import { createLogger } from '../../src/server/logger.js';
import type { Logger, LogLevel } from '../../src/server/logger.js';

export interface CapturedLogger {
  logger: Logger;
  /** Every line logged so far, parsed from JSON. */
  lines: () => Record<string, unknown>[];
  /** Everything logged so far, raw, for "never appears" assertions. */
  text: () => string;
}

/** A real logger whose output is kept in memory instead of going to stdout. */
export function captureLogger(level: LogLevel = 'info'): CapturedLogger {
  const chunks: string[] = [];
  const logger = createLogger(level, {
    write(chunk: string) {
      chunks.push(chunk);
    },
  });
  const text = (): string => chunks.join('');
  return {
    logger,
    text,
    lines: () =>
      text()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
