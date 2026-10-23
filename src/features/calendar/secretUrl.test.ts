import { describe, expect, it } from 'vitest';
import { InvalidSecretUrlError, SecretUrl } from './secretUrl.js';

const RAW = 'https://cal.example/feeds/ada/private-feed.txt';
// sha256 of RAW, first 8 hex, computed with `node -e` outside this code.
const FINGERPRINT = 'cal.example#9ec50bcd';

describe('SecretUrl.parse', () => {
  it('accepts an https address and reveals it unchanged', () => {
    expect(SecretUrl.parse(RAW).reveal()).toBe(RAW);
  });

  it('normalizes a webcal address to https', () => {
    // Built at runtime so the literal never sits in a tracked file.
    const webcal = ['webcal', '://cal.example/feeds/ada/private-feed.txt'].join('');
    expect(SecretUrl.parse(webcal).reveal()).toBe(RAW);
    expect(SecretUrl.parse(webcal.toUpperCase().replace('CAL.EXAMPLE', 'cal.example')).reveal()).toBe(
      'https://cal.example/FEEDS/ADA/PRIVATE-FEED.TXT',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(SecretUrl.parse(`  ${RAW}\n`).reveal()).toBe(RAW);
  });

  it('rejects http with a message that says why', () => {
    expect(() => SecretUrl.parse('http://cal.example/feed')).toThrow(InvalidSecretUrlError);
    expect(() => SecretUrl.parse('http://cal.example/feed')).toThrow(/https/);
  });

  it.each(['', 'cal.example/feed', 'ftp://cal.example/feed', 'https://', 'not a url'])(
    'rejects %j, which is not an absolute https address with a host',
    (raw) => {
      expect(() => SecretUrl.parse(raw)).toThrow(InvalidSecretUrlError);
    },
  );

  it('never repeats the input in the error message', () => {
    const raw = 'http://cal.example/feeds/ada/private-feed.txt';
    let message = '';
    try {
      SecretUrl.parse(raw);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain('private-feed');
    expect(message).not.toContain('cal.example');
  });
});

describe('SecretUrl masking', () => {
  it('fingerprints as host plus the first 8 hex of the SHA-256 of the normalized address', () => {
    expect(SecretUrl.parse(RAW).fingerprint).toBe(FINGERPRINT);
  });

  it('gives the same fingerprint for the webcal and https spellings', () => {
    const webcal = ['webcal', '://cal.example/feeds/ada/private-feed.txt'].join('');
    expect(SecretUrl.parse(webcal).fingerprint).toBe(FINGERPRINT);
  });

  it('shows only the fingerprint when stringified, interpolated or serialized', () => {
    const url = SecretUrl.parse(RAW);
    expect(url.toString()).toBe(FINGERPRINT);
    // The interpolation is the point of the test: it must give the mask.
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    expect(`${url}`).toBe(FINGERPRINT);
    expect(String(url)).toBe(FINGERPRINT);
    expect(JSON.stringify({ url })).toBe(`{"url":"${FINGERPRINT}"}`);
    expect(JSON.stringify(url)).not.toContain('private-feed');
  });

  it('keeps the raw address out of its enumerable state', () => {
    const url = SecretUrl.parse(RAW);
    expect(JSON.stringify(Object.entries(url))).not.toContain('private-feed');
    expect(Object.keys(url)).not.toContain('raw');
  });
});
