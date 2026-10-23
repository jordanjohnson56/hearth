// Fetches a feed over the injected fetch with the bounds the spec sets: a
// timeout, a body cap, at most two redirects, https on every hop, every
// hop on the host the address names (a hop elsewhere is a sign-in page,
// and the secret must not be presented to another site). Calls
// SecretUrl.reveal() for the outbound request; the only other callers are
// the source repository's two secret-table writes (test/revealBoundary.test.ts
// pins the call sites). A failure is a classification and nothing else: the
// underlying error may quote the address.
import type { SecretUrl } from './secretUrl.js';
import type { FetchFailure } from './types.js';

export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 2;

export type FetchOutcome = { ok: true; text: string } | { ok: false; failure: FetchFailure };

export interface FetchLimits {
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The feed text behind `url`, or why it could not be had. Never throws. */
export async function fetchFeed(
  fetch: typeof globalThis.fetch,
  url: SecretUrl,
  limits: FetchLimits = {},
): Promise<FetchOutcome> {
  const timeoutMs = limits.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBodyBytes = limits.maxBodyBytes ?? MAX_BODY_BYTES;
  const maxRedirects = limits.maxRedirects ?? MAX_REDIRECTS;
  // One deadline for every hop and the body read together.
  const signal = AbortSignal.timeout(timeoutMs);
  let target = url.reveal();
  try {
    for (let hop = 0; ; hop += 1) {
      const res = await fetch(target, { redirect: 'manual', signal });
      if (REDIRECT_STATUSES.has(res.status)) {
        const next = redirectTarget(res, target);
        await res.body?.cancel();
        // A third redirect, a missing Location or a hop off https is refused
        // and reported as the redirect status itself.
        if (hop >= maxRedirects || next === undefined) return { ok: false, failure: httpFailure(res.status) };
        if (!sameHost(target, next)) return { ok: false, failure: 'redirected-away' };
        target = next;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, failure: httpFailure(res.status) };
      }
      const text = await readBody(res, maxBodyBytes);
      return text === undefined ? { ok: false, failure: 'too-large' } : { ok: true, text };
    }
  } catch (err) {
    return { ok: false, failure: isTimeout(err) ? 'timeout' : 'network' };
  }
}

function httpFailure(status: number): FetchFailure {
  return `http ${status}`;
}

function redirectTarget(res: Response, from: string): string | undefined {
  const location = res.headers.get('location');
  if (location === null) return undefined;
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return undefined;
  }
  return next.protocol === 'https:' ? next.href : undefined;
}

/** Whether `next` stays on the host `from` named; the URL parser already lowercases hosts. */
function sameHost(from: string, next: string): boolean {
  return new URL(from).host === new URL(next).host;
}

/** The body as text, or undefined once it has grown past `maxBytes`. */
async function readBody(res: Response, maxBytes: number): Promise<string | undefined> {
  if (res.body === null) return '';
  // Node's DOM-less typings leave the reader's chunk type as any.
  const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, size));
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** undici rejects with a TimeoutError (AbortSignal.timeout) or an AbortError. */
function isTimeout(err: unknown): boolean {
  const name: unknown = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}
