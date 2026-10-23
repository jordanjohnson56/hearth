# 3. Use ical.js for iCalendar parsing and recurrence expansion

- Status: Proposed (needs human approval on PR #24)
- Date: 2026-10-23
- Ticket: #17 (M1.3), expansion in #18 (M1.4)

## Context

Calendar sources are Google Calendar secret-address feeds: iCalendar text
with `VEVENT`s, `RRULE`s, `EXDATE`s, `RECURRENCE-ID` overrides and a
`VTIMEZONE` per zone the feed uses. Hearth stores the expanded occurrences
for a window of fifteen months and shows them in the household's zone.
Getting recurrence wrong is the classic calendar bug (a weekly event that
drifts an hour across DST, an override shown twice, a skipped instance
that reappears), and the spec (#14) made correctness the deciding
criterion.

## Options

**ical.js 2.2.1 (Mozilla).** Parses to jCal, exposes components and
properties, expands recurrence through `Event#iterator()` and
`getOccurrenceDetails()` with `EXDATE` and `RECURRENCE-ID` applied, and
resolves `TZID`s against the `VTIMEZONE`s in the same `VCALENDAR` with no
registration step. ESM, no dependencies, used by Thunderbird. Verified by
running against hand-written feeds (the probe notes behind this branch):
DST transitions keep wall time, overrides replace rather than duplicate,
`COUNT`/`UNTIL`/`INTERVAL`/`BYDAY` behave as RFC 5545 says. Rough edges:
a default export only; `skipLibCheck` needed for its typings; no zone
database of its own; `toJSDate()` on a floating value reads the process
zone; one malformed `RRULE` makes `parse` throw for the whole feed.

**A homegrown expander.** Attractive because M2's chores recurrence will
need something, and a shared one looks like reuse. Rejected: the rule set
the feeds use (`BYDAY` with ordinals, `BYMONTHDAY`, `UNTIL` in UTC against
a zoned `DTSTART`, overrides keyed by instance) is far larger than what
chores need, and every mistake shows up on the kitchen wall as a missing
or duplicated event. Chores recurrence is a small subset decided on its
own in M2.

**node-ical / rrule.** Thinner wrappers that still rely on an expander;
node-ical pulls in `rrule` plus a zone library and reads the process
zone in places. Not worth a second dependency when ical.js covers both
parsing and expansion.

## Decision

Use **ical.js**, server-only, through a single module: the
`CalendarProvider` (`src/features/calendar/provider.ts`). It takes feed
text, a local-date window and the configured zone and returns Hearth's
own `ParsedEvent` union (timed instants, all-day local dates with an
exclusive end). No ical.js type is exported from it; the rest of the
feature, the client and the tests see only Hearth's types.

Zone handling, given that ical.js ships no zone database:

- A `TZID` resolves from the `VTIMEZONE` in the same feed, which Google
  always includes. The parsed `VEVENT`s stay attached to their root
  component, and `TimezoneService.register` is never called, so one
  feed's definitions cannot leak into another's.
- A `TZID` the feed does not define, and a floating value (no `TZID`, no
  `Z`), are wall times in the configured zone, converted by the core's
  `wallTimeToInstant` (temporal-polyfill, ADR 0001). `toJSDate()` is
  never used for them. `X-WR-TIMEZONE` is ignored.
- A `UTC` or resolved value converts through ical.js's own offset math.

## Consequences

- `ical.js` is a production dependency of the server; the client bundle
  never sees it (the feature's client half imports only `types.ts`).
- `skipLibCheck` stays on (it already was).
- A feed whose text does not parse at all is a fetch failure (`not-ics`);
  a single `VEVENT` whose start, end or recurrence cannot be read is
  skipped and counted on the source row. ical.js also rejects one bad
  property value (`RRULE:FREQ=BOGUS`) at parse time for the whole feed;
  the provider tells that apart from a malformed feed (a `ParserError`),
  cuts out each `VEVENT` block that does not parse on its own, counts it
  and parses the rest, so one broken event never fails a source.
- Recurrence expansion (#18) lives inside the provider at `occurrencesOf`.
  Masters and overrides are grouped by UID and related explicitly, never
  auto-related across UIDs. The scan runs from `DTSTART` (or, for a
  `DAILY`/`WEEKLY` rule without `COUNT`, from a whole number of periods
  before the window, since `iterator(start)` re-bases a rule rather than
  skipping ahead) and stops once an instance starts after the window; a
  master past 10,000 iterations is skipped and counted. An override whose
  original instance lies outside the scan is still shown at its new time.
  An override with no master in the feed (an orphan) is shown as a single
  event, as Google Calendar does. Every occurrence of a recurring event
  carries its recurrence id, so `uid` plus `recurrenceId` names an
  occurrence; a single event's is null.
- If ical.js is ever replaced, the provider is the one module to rewrite
  and its fixture tests are the acceptance suite.
