import { describe, expect, it } from 'vitest';
import { injectZone } from './index-html.js';

describe('injectZone', () => {
  it('places the meta tag just before a closing head tag in any case', () => {
    expect(injectZone('<HEAD><title>t</title></HEAD><body></body>', 'Europe/Paris')).toBe(
      '<HEAD><title>t</title><meta name="hearth-zone" content="Europe/Paris"></HEAD><body></body>',
    );
  });

  it('puts the meta tag first when the document has no head', () => {
    expect(injectZone('<p>bare</p>', 'UTC')).toBe(
      '<meta name="hearth-zone" content="UTC"><p>bare</p>',
    );
  });

  it('touches only the first closing head tag', () => {
    expect(injectZone('</head><pre></head></pre>', 'UTC')).toBe(
      '<meta name="hearth-zone" content="UTC"></head><pre></head></pre>',
    );
  });
});
