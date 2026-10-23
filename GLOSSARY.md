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
and that is correct.

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
