# 2. Store instants as INTEGER epoch milliseconds (UTC)

- Status: Accepted (approved by Jordan on PR #12, 2026-10-23)
- Date: 2026-10-23
- Ticket: #8 (M0.5)

## Context

`docs/DESIGN.md` section 5 says instants are stored as UTC, either as epoch
milliseconds or as ISO-8601 with `Z`, and that one encoding is used
everywhere. The first instant column is the migration table's `applied_at`.
Many more follow: completion and void times, calendar fetch times and event
times. The week and season totals are range queries over these columns,
such as `completed_at >= ? AND completed_at < ?`.

Local dates (season start and end) are a different thing: dates on a wall
calendar, not points in time. They stay `YYYY-MM-DD` text (see Consequences).

## Options

**INTEGER epoch milliseconds.**

- Comparing and sorting are numeric, so a range query is correct whatever
  code wrote the value.
- Maps exactly onto `Date#getTime()` / `new Date(ms)` and Temporal's
  `epochMilliseconds`, with no parsing and no precision question. A `Date`
  holds milliseconds, so nothing is lost.
- In a `STRICT` table an `INTEGER` column rejects an ISO string written by
  mistake (`cannot store TEXT value in INTEGER column`).
- 8 bytes or fewer per value, and cheap to index.
- Costs: unreadable in the sqlite3 shell without a conversion, and the
  seconds-versus-milliseconds mix-up that integer timestamps invite.

**ISO-8601 TEXT with `Z`.**

- Readable in the shell and in a dump, and SQLite's date functions accept
  it directly.
- Text order matches time order only if every writer uses exactly the same
  shape. `Date#toISOString()` always writes milliseconds, but
  `Temporal.Instant#toString()` omits zero fractions: it gives
  `2026-10-23T14:00:00Z` for one instant and `2026-10-23T14:00:00.5Z` half a
  second later. As text the earlier one sorts *after* the later one,
  because `Z` (0x5A) is greater than `.` (0x2E). A range query then silently
  drops or includes the wrong rows. Offsets (`-05:00`) are also valid
  ISO-8601 and compare wrongly. Guarding against this needs a shape `CHECK`
  on every instant column and discipline in every writer.
- About 24 bytes per value.

## Decision

Store every instant as `INTEGER` epoch milliseconds, UTC, in a `STRICT`
table, in a column whose name ends in `_at` (`applied_at`, `completed_at`,
`voided_at`, `fetched_at`).

Repositories convert at their boundary: they write `date.getTime()` and read
`new Date(row.x_at)`. Code above the repositories sees `Date` (an instant,
see `GLOSSARY.md`), never a raw number.

The deciding argument is that numeric comparison is correct by
construction, while text comparison is correct only by convention, and the
two date libraries this codebase uses already disagree on that convention.
Readability in the shell is the real cost; it is paid only when someone
debugs by hand, and one expression covers it:

```sql
SELECT strftime('%Y-%m-%dT%H:%M:%fZ', applied_at / 1000.0, 'unixepoch') FROM migration;
```

## Consequences

- Every new table is `STRICT`, and every instant column is
  `<name>_at INTEGER`. Feature migrations in M1 and M2 follow this.
- `STRICT` does not stop a seconds value being stored in a milliseconds
  column. All writes go through repositories that call `getTime()`, which
  is the guard. A table may add a sanity `CHECK` (for example
  `completed_at > 946684800000`, after 2000-01-01) where a wrong unit would
  be costly.
- Inclusive local dates, which are not instants, are the documented
  exception: `YYYY-MM-DD` text in a column named `<name>_date`, with
  `CHECK (date(x) IS x)`. That fixed shape sorts correctly as text, and the
  check rejects every other shape and impossible dates such as
  `2026-02-30`.
- This ADR fixes the storage encoding only. How an instant travels in an
  API's JSON is decided with the first route that returns one.
