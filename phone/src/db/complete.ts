import { nextOccurrenceDraft, taskSchema, type OccurrenceDraft } from "@layp/shared";
import type { Run, SqlStatement } from "./sql";

const TASK_COLUMNS = `id, series_id, list_id, section_id, parent_id, title, notes, priority,
  important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
  estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at`;

/** One stamp for the completion and the next occurrence. Placeholders stay in appearance order. */
export function occurrenceStatements(id: string, draft: OccurrenceDraft, sortOrder: number, stamp: string, newId: () => string): SqlStatement[] {
  const statements: SqlStatement[] = [
    {
      sql: `INSERT INTO tasks (
         id, series_id, list_id, section_id, parent_id, title, notes, priority,
         important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
         estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16,
         $17, 0, $18, NULL, NULL, $19, $19
       )`,
      values: [
        id,
        draft.seriesId,
        draft.listId,
        draft.sectionId,
        draft.parentId,
        draft.title,
        draft.notes,
        draft.priority,
        draft.important ? 1 : 0,
        draft.urgent ? 1 : 0,
        draft.pinned ? 1 : 0,
        draft.startOn,
        draft.dueOn,
        draft.dueTime,
        draft.durationMinutes,
        draft.recurrenceJson,
        draft.estimatedPomos,
        sortOrder,
        stamp,
      ],
    },
  ];
  for (const tagId of draft.tagIds) {
    statements.push({ sql: `INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)`, values: [id, tagId] });
  }
  for (const minutes of draft.reminderOffsets) {
    statements.push({
      sql: `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, $4)`,
      values: [newId(), id, minutes, stamp],
    });
  }
  for (const row of draft.checklistReminders) {
    statements.push({
      sql: `INSERT INTO checklist_reminders (
         id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      values: [newId(), id, row.lineText, row.dueOn, row.dueTime, row.minutesBefore, row.firedAt, stamp],
    });
  }
  return statements;
}

export async function completeOn(run: Run, id: string, stamp: string, today: string, newId: () => string): Promise<"saved" | "none"> {
  const loaded = await run([
    { sql: `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1`, values: [id] },
    { sql: `SELECT tag_id FROM task_tags WHERE task_id = $1`, values: [id] },
    { sql: `SELECT minutes_before FROM reminders WHERE task_id = $1`, values: [id] },
    { sql: `SELECT line_text, due_on, due_time, minutes_before FROM checklist_reminders WHERE task_id = $1`, values: [id] },
  ]);
  const raw = loaded.batches[0]?.rows[0];
  if (!raw) return "none";
  const task = taskSchema.parse(raw);
  if (task.deletedAt || task.completedAt) return "none";
  const draft = nextOccurrenceDraft(
    {
      seriesId: task.seriesId,
      listId: task.listId,
      sectionId: task.sectionId,
      parentId: task.parentId,
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      important: task.important,
      urgent: task.urgent,
      pinned: task.pinned,
      startOn: task.startOn,
      dueOn: task.dueOn,
      dueTime: task.dueTime,
      durationMinutes: task.durationMinutes,
      estimatedPomos: task.estimatedPomos,
      recurrenceJson: task.recurrenceJson,
      tagIds: strings(loaded.batches[1]?.rows ?? [], "tag_id"),
      reminderOffsets: (loaded.batches[2]?.rows ?? []).map((row) => Number(row.minutes_before)),
      checklistReminders: (loaded.batches[3]?.rows ?? []).map((row) => ({
        lineText: String(row.line_text),
        dueOn: String(row.due_on),
        dueTime: row.due_time == null ? null : String(row.due_time),
        minutesBefore: Number(row.minutes_before),
      })),
    },
    today,
  );
  const statements: SqlStatement[] = [
    {
      sql: `UPDATE tasks SET completed_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL`,
      values: [stamp, id],
    },
  ];
  if (draft) {
    const max = await run([
      { sql: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM tasks WHERE list_id = $1`, values: [draft.listId] },
    ]);
    const sortOrder = Number(max.batches[0]?.rows[0]?.max_sort ?? 0) + 1;
    statements.push(...occurrenceStatements(newId(), draft, sortOrder, stamp, newId));
  }
  await run(statements);
  return "saved";
}

function strings(rows: Record<string, unknown>[], key: string): string[] {
  return rows.flatMap((row) => (typeof row[key] === "string" ? [row[key]] : []));
}
