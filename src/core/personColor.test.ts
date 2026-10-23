import { describe, expect, it } from 'vitest';
import { PERSON_COLORS, isPersonColor } from './personColor.js';

describe('person color palette', () => {
  it('offers named tokens, each a lowercase word', () => {
    expect(PERSON_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(PERSON_COLORS).size).toBe(PERSON_COLORS.length);
    for (const token of PERSON_COLORS) expect(token).toMatch(/^[a-z]+$/);
  });

  it('accepts every palette token', () => {
    for (const token of PERSON_COLORS) expect(isPersonColor(token)).toBe(true);
  });

  it.each(['', 'Ember', '#c2410c', 'tomato', ' lake', 'lake '])('rejects %j', (value) => {
    expect(isPersonColor(value)).toBe(false);
  });
});
