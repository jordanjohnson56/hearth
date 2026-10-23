# Glossary

Terms with a precise meaning in Hearth. Use them as defined here in code,
tests, issues and docs.

**Instant**: a point on the global timeline, independent of any zone. Passed
around as a JavaScript `Date`. Completions, `now` and week starts are
instants. Stored as INTEGER epoch milliseconds (UTC) in a column named
`*_at` (ADR 0002).

**Zone** (configured zone): the IANA time zone name, such as
`America/Chicago`, in which the household lives. It comes from config at the
boundary and is passed into the pure core. Fixed offsets such as `-06:00`
are not zones for Hearth's purposes, because they carry no DST rules.

**Local date**: the calendar date shown on a wall clock in the configured
zone at a given instant, written `YYYY-MM-DD` (type `LocalDate`). It is
derived from an instant plus the zone and is never stored as the source of
truth. _Avoid_: "day" when the zone is ambiguous; "date" for a `Date`
object.

**Week**: Monday 00:00 local to the following Monday 00:00 local in the
configured zone. A week containing a DST transition lasts 167 or 169 hours,
and that is correct. The month grid's Sunday-first rows are a display
choice; Week remains the Monday scoring week.

**Week start**: the instant at which a week begins. If Monday 00:00 does not
exist in the zone (a DST gap at midnight), it is the first instant of that
Monday.

**Season**: a named, inclusive range of local dates (`start_date` through
`end_date`, end not before start) with a reward. Its dates are stored as
`YYYY-MM-DD` text, the one exception to "local dates are never stored":
a season is defined on the wall calendar, not derived from an instant.

**Migration**: one numbered, named step of schema change (`{ id, name, sql }`).
Once applied anywhere, it is never edited, removed or renumbered; a change
is a new migration ("fix forward").

**Migration set**: the ordered migrations of one scope, numbered 1, 2, 3…
with no gaps. The runner applies the core set first, then each feature's set
in server registry order.

**Scope** (migration scope): which set a migration belongs to: `'core'` or a
`FeatureId`. A migration is identified by scope and id together
(`chores#1`), so the same id in different scopes is not a collision.

**Applied migration**: a migration recorded in the `migration` table with
its applied-at instant. It ran in one transaction together with that
record, so a migration is either applied and recorded or neither.

**Feature context**: what the app factory hands a feature's `createRouter`
and `createJob` once the database is migrated: the database, the
broadcaster, the logger, the config, `now()`, `fetch` and `requireAdmin`.
A feature reaches the outside world only through it, so a test can inject
a clock and a fake network. _Avoid_: globals, service locator.

**Feature job**: a named recurring task a feature builds from its context
(`{ name, intervalMs, run }`). The scheduler runs it once after the server
is listening and then every `intervalMs`, skipping a tick while a run is
still in progress. _Avoid_: cron, poller.

**Admin session**: the time between a successful unlock and a lock, kept
as an unlock token in the client's memory and the server's. It ends on
"lock now", 10 minutes after its last use, 60 minutes after unlock, on a
page reload and on a server restart. _Avoid_: login, logged in.

**Unlock token**: the random bearer credential `POST /api/admin/unlock`
issues for one admin session; every admin mutation carries it as
`Authorization: Bearer`. It is never stored anywhere but memory.
_Avoid_: session cookie, API key.

**Theme times**: the two wall-clock times, light-from and dark-from (`HH:MM`
in the configured zone), between which the display is light or dark. The
theme is light from light-from up to dark-from and dark the rest of the day,
in wall-clock minute order, whichever of the two comes first. _Avoid_:
night mode, dark mode toggle.

**Calendar source** (source): a labelled, colored iCal feed Hearth polls, with
a secret URL. Its events are replaced wholesale on each successful fetch;
a failed fetch keeps the last good ones. _Avoid_: calendar (that is the
feature), subscription, account.

**Event**: a normalized timed or all-day entry from one source: title,
location, start and end, in Hearth's own type, never the library's. A timed
event is an instant range; an all-day event is a local-date range with an
exclusive end. _Avoid_: appointment, entry.

**Occurrence**: one expanded instance of a recurring event, or a single
event's only instance. Named by the event's UID plus its recurrence id
(null for a single event); a RECURRENCE-ID override replaces the
occurrence it names rather than adding one. Stored rows are occurrences
within the poll window; the calendar is a view, not a record. _Avoid_:
instance (ambiguous with a RECURRENCE-ID override), expansion.

**Secret URL** (secret address): the iCal address of a source. A bearer
credential to the whole calendar: it exists as a string only in the admin
request body, the secret-table writes and the fetcher's request, and
everywhere else as a `SecretUrl` whose string form is the fingerprint (host
plus a short hash). It lives only in the database, in its own table that
the source row mapper never selects. _Avoid_: feed URL, link.

**Stale**: the newest successful fetch across every source is older than 60
minutes. A source that has never succeeded is "not yet fetched", not stale.
_Avoid_: outdated, expired.

**Change digest**: a SHA-256 over a source's stored event set, order
independent, computed from the rows a refresh replaces and from the rows it
writes. A poll or refresh publishes the `calendar` change hint only when the
two differ; an admin add, change or delete publishes one hint on its own.
_Avoid_: checksum, etag.

**Pending migration**: a migration in the code that the database has not
recorded as applied. The server applies pending migrations at boot, before
it listens, and refuses to start if one fails.

**Icon** (person icon): a token naming one of the app's kid-friendly
monochrome icons (an animal, character, food and so on), such as `fox`. It is
not a file or an emoji. It is drawn in the person's color and shown when the
person has no photo avatar. Avoid: emoji, glyph.

**Avatar**: how a person is drawn: their photo if one was uploaded, else their
icon, else a colored initial.

**Person color**: a palette token such as `ember` or `lake`
(`src/core/personColor.ts`), never a color value. Each theme maps the token to
a value with at least 4.5:1 contrast on its surfaces. Avoid: hex color.

**Chore**: a named, repeatable piece of housework with a recurrence rule, a
point value and a start date. A chore is archived, never deleted. It has no
owner: chores are a shared pool, not assignments. _Avoid_: task, assignment.

**Recurrence rule** (rule): the schedule that says on which local dates a
chore is to be done, in Hearth's own small set of kinds (daily, weekly on
given weekdays, every N days or weeks, monthly on a day, whenever). It is
not an iCalendar RRULE. _Avoid_: RRULE, schedule.

**Due date** (chore): a local date on which a chore's rule says it is to be
done, on or after its start date. Not "occurrence", which is a calendar
term.

**Claim**: the act of tapping a chore and then a person at the wall, which
records a completion. Anyone at the wall may claim; no PIN. _Avoid_:
check off, assign.

**Completion**: the record that a person did a chore at an instant, with the
points awarded copied from the chore at that moment. Completions are never
edited or removed; a mistaken one is voided. _Avoid_: check, done record.

**Void**: the record that a completion no longer counts, with a reason: an
undo (made at the wall within seconds of the claim) or a correction (made by
an admin). A voided completion earns nothing and satisfies nothing.
_Avoid_: delete, revert.

**Correction**: an admin action on a completion after the undo window: a
void, or a reassignment, which voids the completion and records a new one
for another person at the original instant with the original points.
_Avoid_: edit, fix.

**Waiting** (chore state): a chore with a due date on or before today that
is later than the local date of its last unvoided completion (or its start
date, if none). A waiting chore is claimable; a claim satisfies every due
date up to today. A scheduled chore that is not waiting cannot be claimed.
_Avoid_: pending, open, unclaimed.

**Anytime chore**: a chore whose rule is "whenever": it has no due dates, is
never waiting or overdue, never enters the pool, and can be claimed once per
local day from its own section of the Chores page. _Avoid_: bonus chore,
extra, one-off.

**Overdue**: a waiting chore whose earliest unsatisfied due date is before
today. It is one item however many due dates it has missed; its lateness
is the days since that earliest date. _Avoid_: late, missed (as a count).

**Due today**: a waiting chore whose earliest unsatisfied due date is today.

**Pool**: the set of waiting chores, shown overdue first, then by points.
_Avoid_: todo list, queue.

**Leaderboard**: every person's points for the current week, highest first,
equal points sharing a rank, zero included. _Avoid_: scoreboard, ranking.
