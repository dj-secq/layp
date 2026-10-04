import { z } from "zod";
import { ftsMatch, likePattern } from "../lib/search";
import { query } from "./client";

const taskHit = z.object({
  id: z.string(),
  title: z.string(),
  list_name: z.string(),
});

const dayHit = z.object({
  day: z.string(),
  kind: z.string(),
});

export type SearchHit = { id: string; title: string; listName: string };
export type DayHit = { day: string; label: string };

const dayLabel = (kinds: Set<string>) =>
  kinds.has("diary") && kinds.has("tracker") ? "Diary and tracker" : kinds.has("diary") ? "Diary" : "Tracker";

export async function searchAll(text: string): Promise<{ tasks: SearchHit[]; days: DayHit[] }> {
  const trimmed = text.trim();
  if (!trimmed) return { tasks: [], days: [] };
  const match = ftsMatch(trimmed);
  if (!match) {
    if (trimmed.length > 1) return { tasks: [], days: [] };
    return searchLike(trimmed);
  }
  return searchFts(match);
}

async function searchLike(trimmed: string): Promise<{ tasks: SearchHit[]; days: DayHit[] }> {
  const pattern = likePattern(trimmed);
  const tasks = await query<unknown>(
    `SELECT t.id, t.title, l.name AS list_name
     FROM tasks t JOIN lists l ON l.id = t.list_id
     WHERE t.deleted_at IS NULL AND (t.title LIKE $1 ESCAPE '\\' OR t.notes LIKE $1 ESCAPE '\\')
     ORDER BY t.updated_at DESC
     LIMIT 50`,
    [pattern],
  );
  const days = await query<unknown>(
    `SELECT day, kind FROM (
       SELECT day, 'diary' AS kind FROM days WHERE diary LIKE $1 ESCAPE '\\'
       UNION ALL
       SELECT day, 'tracker' AS kind FROM tracker_logs WHERE note LIKE $1 ESCAPE '\\'
     ) ORDER BY day DESC LIMIT 80`,
    [pattern],
  );
  const grouped = new Map<string, Set<string>>();
  for (const row of days.map((item) => dayHit.parse(item))) {
    const kinds = grouped.get(row.day) ?? new Set<string>();
    kinds.add(row.kind);
    grouped.set(row.day, kinds);
  }
  return {
    tasks: mapTasks(tasks),
    days: [...grouped.entries()].slice(0, 50).map(([day, kinds]) => ({ day, label: dayLabel(kinds) })),
  };
}

async function searchFts(match: string): Promise<{ tasks: SearchHit[]; days: DayHit[] }> {
  const tasks = await query<unknown>(
    `SELECT t.id, t.title, l.name AS list_name
     FROM tasks_fts
     JOIN tasks t ON t.rowid = tasks_fts.rowid
     JOIN lists l ON l.id = t.list_id
     WHERE tasks_fts MATCH $1 AND t.deleted_at IS NULL
     ORDER BY bm25(tasks_fts, 8.0, 1.0)
     LIMIT 50`,
    [match],
  );
  const days = await query<unknown>(
    `SELECT day, kind, rank FROM (
       SELECT d.day AS day, 'diary' AS kind, bm25(days_fts) AS rank
       FROM days_fts JOIN days d ON d.rowid = days_fts.rowid
       WHERE days_fts MATCH $1
       ORDER BY rank
       LIMIT 50
     )
     UNION ALL
     SELECT day, kind, rank FROM (
       SELECT t.day AS day, 'tracker' AS kind, bm25(tracker_fts) AS rank
       FROM tracker_fts JOIN tracker_logs t ON t.rowid = tracker_fts.rowid
       WHERE tracker_fts MATCH $1
       ORDER BY rank
       LIMIT 50
     )`,
    [match],
  );
  const ranked = z.object({ day: z.string(), kind: z.string(), rank: z.coerce.number() });
  const grouped = new Map<string, { kinds: Set<string>; rank: number }>();
  for (const row of days.map((item) => ranked.parse(item))) {
    const current = grouped.get(row.day);
    if (!current) grouped.set(row.day, { kinds: new Set([row.kind]), rank: row.rank });
    else {
      current.kinds.add(row.kind);
      current.rank = Math.min(current.rank, row.rank);
    }
  }
  return {
    tasks: mapTasks(tasks),
    days: [...grouped.entries()]
      .sort((a, b) => a[1].rank - b[1].rank || b[0].localeCompare(a[0]))
      .slice(0, 50)
      .map(([day, info]) => ({ day, label: dayLabel(info.kinds) })),
  };
}

function mapTasks(tasks: unknown[]): SearchHit[] {
  return tasks.map((row) => {
    const parsed = taskHit.parse(row);
    return { id: parsed.id, title: parsed.title, listName: parsed.list_name };
  });
}
