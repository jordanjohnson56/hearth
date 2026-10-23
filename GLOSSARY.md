# Glossary

Terms with a precise meaning in Hearth. Use them as defined here in code,
tests, issues and docs.

**Instant**: a point on the global timeline, independent of any zone. Passed
around as a JavaScript `Date`. Completions, `now` and week starts are
instants.

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
