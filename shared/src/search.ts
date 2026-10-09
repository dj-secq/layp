/** Bound pattern for a SQLite `LIKE ? ESCAPE '\'` predicate. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const FTS_OPERATORS = /["*^:(){}\\]/g;

/**
 * FTS5 MATCH text for a query longer than one character.
 * Operators and quotes are removed, then the words are one phrase.
 * The last word gets a prefix when it is at least two characters.
 * Returns null for a one-character query or a query that is only operators.
 */
export function ftsMatch(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length <= 1) return null;
  const cleaned = trimmed.replace(FTS_OPERATORS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(" ");
  const phrase = tokens.join(" ");
  const last = tokens[tokens.length - 1] ?? "";
  return last.length >= 2 ? `"${phrase}"*` : `"${phrase}"`;
}
