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

describe('fetchFeed redirects', () => {
  const hop = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

  it('follows a same-host redirect, whatever the case of the host', async () => {
    const { fetch, calls } = fakeFetch({
      [url.reveal()]: hop('https://CAL.example/one'),
      'https://cal.example/one': () => feedResponse(icalFixture('empty')),
    });

    await expect(fetchFeed(fetch, url)).resolves.toEqual({ ok: true, text: icalFixture('empty') });
    expect(calls).toEqual([url.reveal(), 'https://cal.example/one']);
  });

  it('stops at a redirect to another host and reports redirected-away', async () => {
    const { fetch, calls } = fakeFetch({
      [url.reveal()]: hop('https://accounts.example/signin?continue=feed'),
      'https://accounts.example/signin?continue=feed': () => feedResponse(icalFixture('empty')),
    });

    await expect(fetchFeed(fetch, url)).resolves.toEqual({ ok: false, failure: 'redirected-away' });
    expect(calls).toEqual([url.reveal()]);
  });

  it('reports redirected-away for a second hop that leaves the host', async () => {
    const { fetch, calls } = fakeFetch({
      [url.reveal()]: hop('https://cal.example/one'),
      'https://cal.example/one': hop('https://accounts.example/signin'),
    });

    await expect(fetchFeed(fetch, url)).resolves.toEqual({ ok: false, failure: 'redirected-away' });
    expect(calls).toEqual([url.reveal(), 'https://cal.example/one']);
  });

  it('still reports the status for a hop off https, even on the same host', async () => {
    const { fetch } = fakeFetch({ [url.reveal()]: hop('http://cal.example/one') });

    await expect(fetchFeed(fetch, url)).resolves.toEqual({ ok: false, failure: 'http 302' });
  });
});
