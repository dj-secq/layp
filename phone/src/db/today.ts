import { TASKS_FOR_DATE_WHERE, taskSchema, type Task } from "@layp/shared";
import type { Run } from "./sql";

const TASK_COLUMNS = `id, series_id, list_id, section_id, parent_id, title, notes, priority,
  important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
  estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at`;

/** Membership is `TASKS_FOR_DATE_WHERE`. The join only adds the section name. */
export const TODAY_TASKS_SQL = `SELECT ${TASK_COLUMNS}, section_name FROM (
  SELECT tasks.*, sections.name AS section_name
  FROM tasks
  LEFT JOIN sections ON sections.id = tasks.section_id
  WHERE tasks.id IN (SELECT id FROM tasks WHERE ${TASKS_FOR_DATE_WHERE})
) ORDER BY sort_order ASC, created_at ASC`;

export const TODAY_TAGS_SQL = `SELECT task_tags.task_id AS task_id, tags.name AS name
FROM task_tags
JOIN tags ON tags.id = task_tags.tag_id
WHERE task_tags.task_id IN (SELECT id FROM tasks WHERE ${TASKS_FOR_DATE_WHERE})
ORDER BY tags.name ASC`;

export type TodayTask = Task & { sectionName: string | null; tagNames: string[] };

export async function loadToday(run: Run, date: string, today: string): Promise<TodayTask[]> {
  const result = await run([
    { sql: TODAY_TASKS_SQL, values: [date, today] },
    { sql: TODAY_TAGS_SQL, values: [date, today] },
  ]);
  const tags = new Map<string, string[]>();
  for (const row of result.batches[1]?.rows ?? []) {
    if (typeof row.task_id !== "string" || typeof row.name !== "string") continue;
    const list = tags.get(row.task_id) ?? [];
    list.push(row.name);
    tags.set(row.task_id, list);
  }
  return (result.batches[0]?.rows ?? []).map((row) => {
    const task = taskSchema.parse(row);
    const sectionName = typeof row.section_name === "string" ? row.section_name : null;
    return { ...task, sectionName, tagNames: tags.get(task.id) ?? [] };
  });
}
