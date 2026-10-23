// Every person color token must stay legible in both themes (DESIGN section 9).
// Checked once per token here instead of per person: each token's light and
// dark value must reach 4.5:1 against every surface of its theme.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERSON_COLORS } from '../src/core/personColor.js';

const css = readFileSync(new URL('../src/client/styles/theme.css', import.meta.url), 'utf8');

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in theme.css`);
  const body = css.slice(start, css.indexOf('}', start));
  return new Map([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['color-bg', 'color-surface', 'color-surface-raised'];

describe.each([
  ['light', ':root'],
  ['dark (forced)', ":root[data-theme='dark']"],
  ['dark (device setting)', ":root:not([data-theme='light'])"],
])('%s theme', (_name, selector) => {
  const vars = block(selector);

  it.each(PERSON_COLORS)('defines --person-%s with at least 4.5:1 contrast on every surface', (token) => {
    const color = vars.get(`person-${token}`);
    expect(color).toBeDefined();
    for (const surface of SURFACES) {
      const background = vars.get(surface);
      expect(background).toBeDefined();
      expect(contrast(color ?? '', background ?? '')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
