// Turns SQLite's unique-index failure on a name column into the domain error
// the router answers 409 with. Each repository keeps its own trimming policy;
// this only recognises the constraint.

/**
 * Runs `write`, throwing `duplicate()` instead when it breaks the unique
 * index on `column` (as SQLite names it, `table.column`).
 */
export function withUniqueName<T>(write: () => T, column: string, duplicate: () => Error): T {
  try {
    return write();
  } catch (err) {
    if (
      err instanceof Error &&
      (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
      err.message.includes(column)
    ) {
      throw duplicate();
    }
    throw err;
  }
}
