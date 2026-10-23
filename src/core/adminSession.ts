// The admin session's lifetimes, shared by the server (which enforces them
// on its tokens) and the client (which locks its own copy on the same
// clock, so a walked-away tablet does not show an unlocked panel until its
// next call fails).

/** A token dies this long after its last authenticated use... */
export const TOKEN_IDLE_MS = 10 * 60_000;
/** ...and this long after it was issued, however busy it was. */
export const TOKEN_MAX_MS = 60 * 60_000;
