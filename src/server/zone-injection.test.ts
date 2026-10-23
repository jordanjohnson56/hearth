import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testAppOptions, testConfig } from '../../test/helpers/app.js';
import { createApp } from './app.js';

/** The content of the `hearth-zone` meta tag, as it appears in the HTML. */
function zoneMeta(html: string): string | undefined {
  return /<meta name="hearth-zone" content="([^"]*)">/.exec(html)?.[1];
}

describe('configured zone in the served index.html', () => {
  it.each(['/', '/index.html', '/chores', '/calendar/2026/10'])(
    'injects the configured zone into %s',
    async (path) => {
      const app = createApp(testAppOptions({ config: testConfig({ zone: 'Asia/Kolkata' }) }));

      const res = await request(app).get(path);

      expect(res.status).toBe(200);
      expect(res.type).toBe('text/html');
      expect(res.text).toContain('hearth-fixture-index');
      expect(zoneMeta(res.text)).toBe('Asia/Kolkata');
    },
  );

  it('puts the zone inside <head>, before the page body', async () => {
    const res = await request(createApp(testAppOptions())).get('/');

    const meta = res.text.indexOf('<meta name="hearth-zone"');
    expect(meta).toBeGreaterThan(res.text.indexOf('<head>'));
    expect(meta).toBeLessThan(res.text.indexOf('</head>'));
  });

  it('escapes the zone for HTML instead of trusting it', async () => {
    const hostile = 'X/"><script>alert(1)</script><x a=\'&';
    const app = createApp(testAppOptions({ config: testConfig({ zone: hostile }) }));

    const res = await request(app).get('/');

    expect(res.text).not.toContain('<script>alert(1)');
    expect(zoneMeta(res.text)).toBe(
      'X/&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;x a=&#39;&amp;',
    );
  });

  it('still serves other static files unchanged', async () => {
    const res = await request(createApp(testAppOptions())).get('/assets/fixture.css');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/css');
    expect(res.text).toContain('hearth-fixture-asset');
  });

  it('asks the browser to revalidate index.html, so a changed zone shows after a restart', async () => {
    const res = await request(createApp(testAppOptions())).get('/');

    expect(res.headers['cache-control']).toBe('no-cache');
  });
});
