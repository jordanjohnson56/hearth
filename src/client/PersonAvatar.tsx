import type { PersonWire } from '../core/person.js';

/**
 * How a person is drawn (GLOSSARY: Avatar). Photos (M3) and icons (issue
 * 13) are not served yet, so this is always the fallback: the first letter
 * of the name, in the surface color on a disc of the person's color. The
 * palette test holds every token to 4.5:1 against every surface, and the
 * pair is the same either way round, so the letter is legible in both
 * themes. Decorative: callers show the name beside it. Size it with
 * `--avatar-size` on the element or an ancestor (default 2.5rem).
 */
export function PersonAvatar({ person }: { person: Pick<PersonWire, 'displayName' | 'color'> }) {
  return (
    <span className="person-avatar" style={{ background: `var(--person-${person.color})` }} aria-hidden="true">
      {initialOf(person.displayName)}
    </span>
  );
}

/** The first character (code point, so an accented or astral letter stays whole), uppercased. */
export function initialOf(displayName: string): string {
  const [first = ''] = displayName;
  return first.toLocaleUpperCase();
}
