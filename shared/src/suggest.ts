import { Temporal } from "temporal-polyfill";
import { formatClock, type ClockPreference } from "./clock";
import { parseQuickAdd, type QuickList } from "./parse";
import { describeRule } from "./recur";
import type { QuickSnippet } from "./snippets";

type Now = { today: string; minutes: number | null };

export type SuggestContext = {
  lists: QuickList[];
  recentTitles: string[];
  snippets: QuickSnippet[];
};

export type QuickSuggestion = {
  id: string;
  label: string;
  detail: string | null;
  /** The field text after this row is accepted. Accepting does not save. */
  next: string;
};

const CAP = 6;
const STARTERS = ["tomorrow", "tonight", "friday 6pm", "every weekday"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const PHRASES = [
  "today",
  "tomorrow",
  "tonight",
  ...WEEKDAYS,
  ...WEEKDAYS.map((day) => `next ${day}`),
  "every day",
  "every weekday",
  "every week",
  "every month",
  ...WEEKDAYS.map((day) => `every ${day}`),
  "p1",
  "p2",
  "p3",
];

/** One line under the field. Empty input has no label. */
export function previewQuickAdd(input: string, lists: QuickList[], now: Now, clock: ClockPreference): string | null {
  const parsed = parseQuickAdd(input, lists, now);
  if (parsed.status === "empty") return null;
  if (parsed.status === "reject") return "Add a title.";
  if (parsed.notice) return parsed.notice;
  const parts = [parsed.title];
  if (parsed.dueOn) {
    parts.push(
      Temporal.PlainDate.from(parsed.dueOn).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    );
  }
  if (parsed.dueTime) parts.push(formatClock(parsed.dueTime, clock));
  if (parsed.recurrence) parts.push(describeRule(parsed.recurrence));
  if (parsed.listId) {
    const name = lists.find((list) => list.id === parsed.listId)?.name;
    if (name) parts.push(name);
  }
  if (parsed.priority === "high") parts.push("High");
  else if (parsed.priority === "medium") parts.push("Medium");
  else if (parsed.priority === "low") parts.push("Low");
  return parts.join(" · ");
}

/** At most six rows. The first matching rule wins. */
export function suggestQuickAdd(input: string, context: SuggestContext, now: Now): QuickSuggestion[] {
  if (!input.trim()) {
    return [
      ...context.snippets.map(snippetRow),
      ...STARTERS.map((starter) => ({ id: `starter:${starter}`, label: starter, detail: null, next: starter })),
    ].slice(0, CAP);
  }

  if (input.trimStart().startsWith("/")) {
    const query = input.trim().slice(1).trim().toLowerCase();
    return context.snippets
      .filter((snippet) => snippet.name.toLowerCase().startsWith(query))
      .slice(0, CAP)
      .map(snippetRow);
  }

  if (!hasStructure(input, context.lists, now)) {
    const typed = input.trim().toLowerCase();
    const snippets = context.snippets.filter((snippet) => snippet.name.toLowerCase().startsWith(typed));
    if (snippets.length > 0) return snippets.slice(0, CAP).map(snippetRow);
  }

  const list = listPrefix(input);
  if (list) return listSuggestions(list.head, list.prefix, context.lists);

  const token = tokenSpan(input);
  if (token) {
    const rows = tokenSuggestions(input, token.query, token.start);
    if (rows.length > 0) return rows;
  }

  if (hasStructure(input, context.lists, now)) return [];

  const typed = input.trim().toLowerCase();
  return context.recentTitles
    .filter((title) => title.toLowerCase().startsWith(typed) && title.toLowerCase() !== typed)
    .slice(0, CAP)
    .map((title) => ({ id: `title:${title.toLowerCase()}`, label: title, detail: null, next: title }));
}

function snippetRow(snippet: QuickSnippet): QuickSuggestion {
  return { id: `snippet:${snippet.id}`, label: snippet.name, detail: snippet.line, next: snippet.line };
}

function listPrefix(input: string): { head: string; prefix: string } | null {
  const spaced = /^(.*?)in\s+(\S*)$/i.exec(input);
  if (spaced && /(^|\s)in\s+\S*$/i.test(input)) {
    return { head: spaced[1].trimEnd(), prefix: spaced[2] };
  }
  if (/(^|\s)in$/i.test(input)) {
    return { head: input.replace(/(^|\s)in$/i, "").trimEnd(), prefix: "" };
  }
  return null;
}

function listSuggestions(head: string, prefix: string, lists: QuickList[]): QuickSuggestion[] {
  const needle = prefix.toLowerCase();
  const spans = spanPhrases(prefix).map((phrase) => ({
    id: `span:${phrase}`,
    label: phrase,
    detail: null,
    next: joinTail(head, phrase),
  }));
  const names = lists
    .filter((list) => list.name.toLowerCase().startsWith(needle))
    .map((list) => ({
      id: `list:${list.id}`,
      label: list.name,
      detail: null,
      next: joinTail(head, list.name),
    }));
  return [...spans, ...names].slice(0, CAP);
}

function spanPhrases(prefix: string): string[] {
  const match = /^([1-9]\d?)(?:\s+\S*)?$/.exec(prefix.trim());
  if (!match) return [];
  const needle = prefix.trim().toLowerCase();
  return [`${match[1]} days`, `${match[1]} weeks`].filter((phrase) => phrase.startsWith(needle));
}

function joinTail(head: string, tail: string): string {
  return head ? `${head} in ${tail}` : `in ${tail}`;
}

function tokenSpan(input: string): { query: string; start: number } | null {
  if (/\s$/.test(input)) return null;
  const match = /^(.*?)(\S+)$/.exec(input);
  if (!match) return null;
  const word = match[2];
  const head = match[1];
  const prev = /^(.*?)(\S+)\s+$/.exec(head);
  if (prev && (prev[2].toLowerCase() === "every" || prev[2].toLowerCase() === "next")) {
    return { query: `${prev[2]} ${word}`, start: prev[1].length };
  }
  return { query: word, start: head.length };
}

function tokenSuggestions(input: string, query: string, start: number): QuickSuggestion[] {
  const needle = query.toLowerCase();
  const phrases = [...PHRASES.filter((phrase) => phrase.startsWith(needle) && phrase !== needle), ...timePhrases(query)];
  const unique = [...new Set(phrases)];
  return unique.slice(0, CAP).map((phrase) => ({
    id: `token:${phrase}`,
    label: phrase,
    detail: null,
    next: `${input.slice(0, start)}${phrase}`,
  }));
}

function timePhrases(query: string): string[] {
  if (!/^\d{1,2}$/.test(query)) return [];
  const hour = Number(query);
  const phrases: string[] = [];
  if (hour >= 1 && hour <= 12) phrases.push(`${hour}am`, `${hour}pm`);
  if (hour <= 23) phrases.push(`${hour}:00`);
  return phrases;
}

function hasStructure(input: string, lists: QuickList[], now: Now): boolean {
  const parsed = parseQuickAdd(input, lists, now);
  if (parsed.status === "reject") return true;
  if (parsed.status !== "ok") return false;
  return Boolean(
    parsed.dueOn || parsed.dueTime || parsed.recurrence || parsed.priority !== "none" || parsed.listId || parsed.notice,
  );
}
