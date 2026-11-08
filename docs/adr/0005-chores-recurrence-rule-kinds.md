# 5. Chores recurrence is Hearth's own set of rule kinds, not RRULE

- Status: Accepted (approved by Jordan on PR #35, 2026-10-24)
- Date: 2026-10-23
- Ticket: M2 spec (grilling session of 2026-10-23)

## Context

A chore has a recurrence rule that says on which local dates it is to be
done. DESIGN.md section 13 left the format open: an RFC 5545 RRULE subset,
which the calendar already parses, or a smaller format of Hearth's own.
ADR 0003 chose ical.js for calendar feeds and said chores recurrence would
be "a small subset decided on its own in M2". This is that decision.

## Options

**An RRULE text subset.** `FREQ=WEEKLY;BYDAY=MO,TH,SA` stored as text.
Familiar to anyone who has read a feed, and the calendar provider could in
principle expand it. Rejected: ical.js stays behind the provider boundary
(ADR 0003), so chores would need a second RRULE parser written by hand for
a format nobody types on an iPad; the admin form is buttons either way.
RRULE also carries time-of-day and zone semantics (a zoned `DTSTART`, an
`UNTIL` in UTC) that a chore, which is due on a wall date, never needs and
would have to reject or ignore.

**Reusing ical.js for chores.** Rejected in ADR 0003 already: the feed
rule set is far larger than chores need, and every expander mistake shows
on the kitchen wall.

**Hearth's own rule kinds.** A discriminated union with one way to say
each thing, stored as JSON text in the chore row and validated in code at
the admin boundary.

## Decision

A **recurrence rule** is one of five kinds, each expanding to local dates
from the chore's start date onward:

- `daily`: every date.
- `weekly`: a non-empty set of weekday tokens `mon`…`sun`.
- `every`: `{ unit: 'days' | 'weeks', interval: N }` with N ≥ 2, anchored
  on the start date: start + k·N days, or start + k·N weeks on the start
  date's weekday. N = 1 is spelled `daily` or `weekly`.
- `monthly`: a day of month 1–31, clamped to the month's last day.
- `whenever`: no due dates; an anytime chore.

Rules know nothing about times or zones: expansion is pure local-date
arithmetic in the core, and "today" is the configured zone's local date
of `now`, supplied by the boundary. The rule is stored as JSON text in a
single column and validated on every write; what the database checks is
only that the column is non-empty.

## Consequences

- Adding a kind is a code change (type, validation, expansion, admin
  form), never a migration. Changing the meaning of a stored kind is a new
  kind plus a data migration, because stored rules are never reinterpreted.
- A stored rule the code cannot read is a bug, not bad input: the read
  path throws and the HTTP boundary reports it, rather than the chore
  silently vanishing from the pool.
- The two expanders in the codebase (ical.js behind the calendar provider,
  the chores rule core) are deliberate; neither is to be merged into the
  other.
- Due-date expansion is bounded by the start date and today, so a chore's
  waiting state is computed from its rule and its completion log alone;
  no per-due-date rows are stored.
