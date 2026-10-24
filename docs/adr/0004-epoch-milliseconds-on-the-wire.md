# 4. Instants on the wire are epoch-millisecond numbers

- Status: Accepted (approved by Jordan on PR #24, 2026-10-23)
- Date: 2026-10-23
- Ticket: #17 (M1.3)

## Context

ADR 0002 fixed the storage encoding of instants (INTEGER epoch
milliseconds, UTC) and left the JSON encoding to "the first route that
returns one". That route is `GET /api/calendar/events`: event starts and
ends, and the fetch times on a source row. M2's completion times follow
whatever is decided here.

## Decision

An instant in a JSON response or request body is a **number: epoch
milliseconds, UTC**, the same value the database holds and
`Date#getTime()` returns. The client turns it back with `new Date(ms)`
and formats it with `Intl` in the configured zone. Field names end in
`At` (`startAt`, `lastSuccessAt`), mirroring the `_at` columns. A missing
instant is `null`, never `0`.

A **local date** travels as `YYYY-MM-DD` text (`startDate`, `from`,
`to`), the same shape as the `_date` columns and the core's `LocalDate`.

Why numbers over ISO-8601 strings: the value survives the trip untouched
(no parse, no precision or offset question), `JSON.stringify` of a `Date`
would otherwise silently produce a string the server never chose, and the
client has no date library and needs none. The cost, unreadable raw JSON,
is paid only when someone reads a response by hand, and the same
`strftime` trick as ADR 0002 applies.

## Consequences

- Every route after this one encodes instants the same way; a wire type
  for an instant is `number`, never `string` or `Date`.
- Client code never does date arithmetic on the raw number beyond
  `new Date(ms)`; local-date math on the client uses `Intl` parts, since
  the Temporal polyfill stays out of the browser bundle.
- A validation error on an instant or a local date is a 400 with a field
  message naming the expected shape.
