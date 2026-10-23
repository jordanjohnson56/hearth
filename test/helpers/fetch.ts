// A fake outbound fetch for feature tests: fixture feeds and failures by URL.

/** What a fake endpoint answers: a Response, or a rejection like undici's. */
export type FakeEndpoint = () => Response | Promise<Response>;

export interface FakeFetch {
  fetch: typeof globalThis.fetch;
  /** Every URL fetched so far, in order (redirect hops included). */
  calls: string[];
}

/**
 * A fetch that answers from `endpoints` (keyed by exact URL) and rejects
 * any other URL the way undici does for an unreachable host. Pass one
 * endpoint to answer every URL the same way.
 */
export function fakeFetch(endpoints: Record<string, FakeEndpoint> | FakeEndpoint): FakeFetch {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const endpoint = typeof endpoints === 'function' ? endpoints : endpoints[url];
    if (endpoint === undefined) throw networkError(url);
    return endpoint();
  };
  return { fetch, calls };
}

/** A body of `status` with the right content type for a feed. */
export function feedResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/calendar' } });
}

/** How undici reports an unreachable host: the message embeds the URL. */
export function networkError(url: string): Error {
  return Object.assign(new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${url}`), {
    cause: new Error(`getaddrinfo ENOTFOUND ${url}`),
  });
}

/** How a fetch rejects when its signal fires (AbortSignal.timeout gives a TimeoutError). */
export function timeoutError(): Error {
  return Object.assign(new Error('The operation was aborted due to timeout'), {
    name: 'TimeoutError',
  });
}
