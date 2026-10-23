# Glossary

Terms with a precise meaning in Hearth. Use them as defined here in code,
tests, issues and docs.

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

**Season**: a named, inclusive range of local dates (`start_date` through
`end_date`, both `YYYY-MM-DD`, end not before start) with a reward. Stored
as dates, not instants, because it is defined on the wall calendar.
