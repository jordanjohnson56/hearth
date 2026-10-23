// The iCal secret address as a value that cannot leak by accident. The raw
// string exists in three places: the admin request body on the way in
// (parsed here), the two writes to calendar_source_secret in
// sourceRepository.ts (reveal()) and the fetcher's outbound request
// (reveal()). readSourceSecret is the one read of that table and parses the
// column straight back into a SecretUrl; the source row mapper never selects
// it. Everything else (rows, logs, responses, errors) sees the fingerprint.
import { createHash } from 'node:crypto';

/** Bad input; the message is written for the client and never repeats the input. */
export class InvalidSecretUrlError extends Error {
  override name = 'InvalidSecretUrlError';
}

/** The first 8 hex characters of the SHA-256: enough to tell two sources apart. */
const FINGERPRINT_HEX = 8;

export class SecretUrl {
  // A private field (not a property), so Object.keys, spread, JSON and
  // util.inspect never see the address.
  readonly #raw: string;
  /** Host plus a short hash, e.g. `cal.example#1a2b3c4d`. Safe to show and store. */
  readonly fingerprint: string;

  private constructor(normalized: string) {
    this.#raw = normalized;
    const hash = createHash('sha256').update(normalized).digest('hex');
    this.fingerprint = `${new URL(normalized).host}#${hash.slice(0, FINGERPRINT_HEX)}`;
  }

  /**
   * Parses what the administrator pasted: a webcal address becomes https,
   * `http://` and anything that is not an absolute URL with a host is
   * refused with InvalidSecretUrlError.
   */
  static parse(raw: string): SecretUrl {
    const trimmed = raw.trim();
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new InvalidSecretUrlError('Enter the full address, starting with https:// or webcal');
    }
    if (url.protocol === 'http:') {
      throw new InvalidSecretUrlError(
        'A calendar address is a secret: use https (or webcal), not http',
      );
    }
    if (url.protocol === 'webcal:') {
      // URL treats webcal: as a special-case-free scheme; rebuild via text so
      // host, path and query are re-parsed under https rules.
      url = new URL(`https:${url.href.slice('webcal:'.length)}`);
    }
    if (url.protocol !== 'https:' || url.host === '') {
      throw new InvalidSecretUrlError('Enter the full address, starting with https:// or webcal');
    }
    return new SecretUrl(url.href);
  }

  /** The address itself. Called by the fetcher and the secret-table writes only (test/revealBoundary.test.ts). */
  reveal(): string {
    return this.#raw;
  }

  toString(): string {
    return this.fingerprint;
  }

  toJSON(): string {
    return this.fingerprint;
  }
}
