// A person as the wire carries it (GET /api/people, and the chores board
// that embeds the people it references). Shared by both bundles, so types
// only. The avatar path stays on the server until avatar upload (M3) gives
// the client a URL to draw; until then every avatar is the icon or the
// colored initial.
import type { PersonColor } from './personColor.js';

export interface PersonWire {
  id: number;
  displayName: string;
  /** A palette token; draw it as `var(--person-<color>)`. */
  color: PersonColor;
  /** A monochrome icon token, or null (icons are issue 13; always null for now). */
  icon: string | null;
}

/** GET /api/people. */
export interface PeopleResponse {
  people: PersonWire[];
}
