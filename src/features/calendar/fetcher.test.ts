import { describe, expect, it } from 'vitest';
import { fakeFetch, feedResponse } from '../../../test/helpers/fetch.js';
import { icalFixture } from '../../../test/helpers/ical.js';
import { fetchFeed } from './fetcher.js';
import { SecretUrl } from './secretUrl.js';

const url = SecretUrl.parse('https://cal.example/feeds/ada/private-feed-0123456789abcdef.txt');

describe('fetchFeed limits', () => {
  it('reports too-large once the body passes the cap given, without reading the rest', async () => {
    const feed = icalFixture('single-events');
    const { fetch } = fakeFetch(() => feedResponse(feed));

    await expect(fetchFeed(fetch, url, { maxBodyBytes: 64 })).resolves.toEqual({ ok: false, failure: 'too-large' });
    await expect(fetchFeed(fetch, url, { maxBodyBytes: feed.length })).resolves.toEqual({ ok: true, text: feed });
  });

  it('refuses the redirect past the hop count given and reports its status', async () => {
    const hop = (to: string) => new Response(null, { status: 302, headers: { location: to } });
    const { fetch, calls } = fakeFetch({
      [url.reveal()]: () => hop('https://cal.example/one'),
      'https://cal.example/one': () => hop('https://cal.example/two'),
      'https://cal.example/two': () => feedResponse(icalFixture('empty')),
    });

    await expect(fetchFeed(fetch, url, { maxRedirects: 1 })).resolves.toEqual({ ok: false, failure: 'http 302' });
    expect(calls).toEqual([url.reveal(), 'https://cal.example/one']);
  });
});
