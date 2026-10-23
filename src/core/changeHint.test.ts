import { describe, expect, it } from 'vitest';
import { decodeChangeHint, encodeChangeHint } from './changeHint.js';

const ids = ['calendar', 'chores'] as const;

describe('change hint wire format', () => {
  it('encodes a hint as an object holding only the feature id', () => {
    expect(encodeChangeHint('chores')).toBe('{"feature":"chores"}');
  });

  it('decodes a hint for a known feature', () => {
    expect(decodeChangeHint('{"feature":"calendar"}', ids)).toBe('calendar');
  });

  it.each([
    ['an unknown feature', '{"feature":"weather"}'],
    ['malformed JSON', '{"feature":'],
    ['a bare string', '"chores"'],
    ['null', 'null'],
    ['a non-string feature', '{"feature":7}'],
    ['a missing feature', '{}'],
  ])('ignores %s', (_label, data) => {
    expect(decodeChangeHint(data, ids)).toBeNull();
  });
});
