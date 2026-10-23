# 1. Use temporal-polyfill for zoned date math

- Status: Accepted (approved by Jordan on PR #12, 2026-10-23)
- Date: 2026-10-23
- Ticket: #7 (M0.4)

## Context

The pure core turns an instant plus a configured IANA zone into local dates
and Monday-00:00 week starts (see `GLOSSARY.md`). Recurrence, due dates,
weekly scoring, seasons and the client's theme switch (M1) all build on this,
so the library choice is hard to reverse later.

Constraints from #7 and `docs/DESIGN.md`:

1. DST-correct for arbitrary IANA zones, including half-hour zones and days
   whose midnight does not exist.
2. Works in both the Node server bundle and the browser bundle.
3. Small.
4. Maintained.

The core never reads the process zone or the clock, so the library must take
the zone per call rather than through global state.

## Options and measurements

Each candidate was used to write the same two functions (local date and week
start), run against the #7 cases under a non-UTC host zone, and bundled for
the browser with esbuild (`--bundle --minify --format=esm`), gzip -9.

| | temporal-polyfill 1.0.6 | Luxon 3.7.2 | date-fns 4.4.0 + @date-fns/tz 1.5.0 |
|---|---|---|---|
| Our two functions, min+gzip | **19.9 kB** (class API); 8.1 kB with its non-standard `fns` API | 22.1 kB | **7.3 kB** |
| Chicago 2026 DST cases, Kolkata, 167/169 h weeks | all correct | all correct | all correct |
| Invalid zone `Mars/Base` | throws `RangeError` | invalid object (`isValid` false), must be checked | `Invalid Date`, then `RangeError` only when formatted |
| Empty-string zone `""` | throws `RangeError` | invalid object | **silently uses the host's local zone** |
| Invalid `Date` | throws `RangeError` | invalid object | `RangeError` when formatted |
| Type for a local date | `Temporal.PlainDate` (no zone, no time) | `DateTime` (always zoned) | `TZDate`, a `Date` subclass |
| Last release | 2026-10-13; monthly since 1.0 (2026-06) | 2025-09-05 (13 months ago) | 2026-05 (both packages) |
| Dependencies | 2 small (`temporal-spec`, `temporal-utils`) | none | none |
| Tree-shakeable | only via the `fns` API | no | yes |
| Licence | MIT | MIT | MIT |

All three pass the correctness cases, so correctness does not decide this.

## Decision

Use **`temporal-polyfill`** (FullCalendar's implementation of the TC39
Temporal API), through its standard class API:
`import { Temporal } from 'temporal-polyfill'`. Do not install the global
(`temporal-polyfill/global`): the pure core imports it explicitly and
mutates nothing.

Why, against the alternatives:

- **Types match the domain.** `PlainDate` is a local date with no zone or
  time, and `ZonedDateTime` is an instant pinned to a named zone. "Monday
  00:00 local" is `plainDate.toZonedDateTime({ timeZone })`, which resolves a
  missing midnight to the first instant of the day by specification. With
  date-fns a local date is still a `Date`, and confusing a `TZDate` with a
  plain `Date` (whose getters use the host zone) is easy and not caught by
  the type checker. Our recurrence and season code (M1, M2) works mostly on
  local dates, so this benefit compounds.
- **Errors fail loudly.** Bad zones and NaN instants throw `RangeError` at
  the call. date-fns treats `""` as the host zone, which is exactly the kind
  of hidden process-zone dependency the core forbids.
- **It is the platform's future API.** Temporal is a Stage 4 standard that
  already ships natively in Firefox and Chromium-based browsers, but not yet
  in Safari, and not in Node 22 (checked: `typeof Temporal` is `undefined`
  on 22.22). Once both runtimes we target ship it, dropping the dependency is
  a one-line import change per file, since the polyfill follows the spec
  (near-full test262 compliance).
- **Maintained.** Monthly releases this year. Luxon has not released in over
  a year.

Costs we accept:

- **Size.** About 20 kB gzipped in the client bundle once the client uses
  it, against 7 kB for date-fns. For a single wall-mounted dashboard on a
  LAN, that is a few milliseconds. If it ever matters, the same package's
  `fns` API gets to about 8 kB, at the price of a non-standard API we would
  have to rewrite when going native.
- **`Date` at the edges.** The rest of the app passes instants as `Date`
  (DESIGN.md: `now: Date`). The core converts at its entry with
  `Temporal.Instant.fromEpochMilliseconds(date.getTime())` and returns
  `Date` for instants and a branded `YYYY-MM-DD` string for local dates, so
  Temporal objects do not leak into other layers.

## Consequences

- Only `src/core` imports `temporal-polyfill`. Other layers use the core's
  `localDate` / `weekStart` (and later functions) and pass `Date` and zone
  strings.
- A zone must be a named IANA identifier. Fixed offsets such as `-06:00` and
  ISO strings that Temporal would otherwise accept as zones are rejected,
  because they carry no DST rules (see `src/core/time.ts`).
- When Safari and our Node version ship Temporal, revisit this ADR and drop
  the polyfill.
