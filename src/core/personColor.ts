// The palette a person's color is chosen from. A person stores a token, not a
// color value: each token has a light and a dark value in the client theme
// (src/client/styles/theme.css, `--person-<token>`), checked there for
// contrast in both themes. Adding a token needs no migration.

export const PERSON_COLORS = [
  'ember',
  'lake',
  'moss',
  'plum',
  'berry',
  'teal',
  'sun',
  'slate',
  'fuchsia',
] as const;

export type PersonColor = (typeof PERSON_COLORS)[number];

export function isPersonColor(value: string): value is PersonColor {
  return (PERSON_COLORS as readonly string[]).includes(value);
}
