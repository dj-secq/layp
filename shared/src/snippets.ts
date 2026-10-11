export type QuickSnippet = { id: string; name: string; line: string };

export const SNIPPET_CAP = 24;

/** Reads the settings value. A bad or oversized row is dropped. */
export function parseSnippets(raw: string | null | undefined): QuickSnippet[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const snippets: QuickSnippet[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.line !== "string") continue;
    const name = row.name.trim();
    const line = row.line.trim();
    if (name.length < 1 || name.length > 24 || line.length < 1 || line.length > 200) continue;
    if (snippets.some((snippet) => snippet.name.toLowerCase() === name.toLowerCase())) continue;
    snippets.push({ id: row.id, name, line });
    if (snippets.length >= SNIPPET_CAP) break;
  }
  return snippets;
}

export function snippetsJson(snippets: QuickSnippet[]): string {
  return JSON.stringify(snippets);
}

/** Why this name and line cannot be saved, or null when they can. */
export function snippetDraftError(
  snippets: QuickSnippet[],
  name: string,
  line: string,
  ignoreId?: string,
): string | null {
  const cleanName = name.trim();
  const cleanLine = line.trim();
  if (cleanName.length < 1 || cleanName.length > 24) return "Use 1–24 characters for the name.";
  if (cleanLine.length < 1 || cleanLine.length > 200) return "Use 1–200 characters for the line.";
  const taken = snippets.some(
    (snippet) => snippet.id !== ignoreId && snippet.name.toLowerCase() === cleanName.toLowerCase(),
  );
  if (taken) return "That name is already used.";
  if (!ignoreId && snippets.length >= SNIPPET_CAP) return "24 snippets is the limit.";
  return null;
}
