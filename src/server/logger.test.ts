import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.js';
import { redactUrls } from './logger.js';

const SECRET_ICAL =
  'https://calendar.example.com/calendar/ical/ada%40example.com/private-0123abcd/basic.ics?token=s3cr3t';

describe('redactUrls', () => {
  it('keeps only the scheme and host of a URL', () => {
    expect(redactUrls(`GET ${SECRET_ICAL} failed`)).toBe(
      'GET https://calendar.example.com/[redacted] failed',
    );
  });

  it('redacts other schemes, credentials and every URL in the text', () => {
    expect(
      redactUrls('from ftp://user:pw@cal.example/x.ics and http://h.example?q=1'),
    ).toBe('from ftp://cal.example/[redacted] and http://h.example/[redacted]');
  });

  it('leaves text without URLs alone', () => {
    expect(redactUrls('EACCES: permission denied')).toBe('EACCES: permission denied');
  });
});

describe('createLogger', () => {
  it('writes JSON lines with level, time and message', () => {
    const { logger, lines } = captureLogger('info');

    logger.info({ port: 4400 }, 'listening');

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ level: 30, port: 4400, msg: 'listening' });
    expect(Date.parse(String(lines()[0]?.['time']))).not.toBeNaN();
  });

  it('drops lines below the configured level', () => {
    const { logger, lines } = captureLogger('warn');

    logger.info('quiet');
    logger.warn('loud');

    expect(lines().map((line) => line['msg'])).toEqual(['loud']);
  });

  it('redacts a URL in the message string itself, not only under err', () => {
    const { logger, lines, text } = captureLogger();

    logger.warn(`could not fetch ${SECRET_ICAL}`);
    logger.warn({ source: 1 }, `retrying ${SECRET_ICAL} later`);

    expect(lines().map((line) => line['msg'])).toEqual([
      'could not fetch https://calendar.example.com/[redacted]',
      'retrying https://calendar.example.com/[redacted] later',
    ]);
    expect(text()).not.toContain('private-0123abcd');
  });

  it('never writes an error message URL, query string or stack', () => {
    const { logger, lines, text } = captureLogger();
    const err = Object.assign(new Error(`fetch failed for ${SECRET_ICAL}`), {
      code: 'ECONNREFUSED',
    });

    logger.error({ err }, 'calendar sync failed');

    expect(lines()[0]?.['err']).toEqual({
      type: 'Error',
      code: 'ECONNREFUSED',
      message: 'fetch failed for https://calendar.example.com/[redacted]',
    });
    expect(text()).not.toContain('private-0123abcd');
    expect(text()).not.toContain('s3cr3t');
    expect(text()).not.toMatch(/\bat\s.+:\d+:\d+/);
  });
});
