/**
 * Escapes user input for use inside a SQL LIKE/ILIKE pattern, so `%` and `_` are matched literally
 * instead of acting as wildcards (a search for "_" otherwise matches every row). Relies on
 * Postgres's default LIKE escape character, backslash.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** A `%term%` "contains" pattern with the term's own wildcards escaped. */
export function containsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

/** Escapes user input for a literal match inside a RegExp / MongoDB `$regex`. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
