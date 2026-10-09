import { Temporal } from "temporal-polyfill";
import { addDays } from "@layp/shared";
import { nextOccurrenceDraft, parseRule, serializeRule, TASKS_FOR_DATE_WHERE, type RecurrenceRule } from "@layp/shared";
import { describeEdit } from "@layp/shared";
import { parentCreatesCycle, type SubtaskLink } from "@layp/shared";
import { cleanNotes, cleanTitle } from "@layp/shared";
import { attachmentIdsForTasks, dropStoredFiles, trashedAttachmentIds } from "./attachments";
import { syncChecklistReminders } from "./checklistReminders";
import { logFailure, query, withStamp, writeStamped, type SqlStatement } from "./client";
import { deletionStatement } from "./deletions";
import { recordHistory } from "./history";
import { taskSchema, type Priority, type SaveResult, type Task } from "./types";

function parseTask(row: unknown): Task {
  return taskSchema.parse(row);
}

const TASK_COLUMNS = `id, series_id, list_id, section_id, parent_id, title, notes, priority,
  important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
  estimated_pomos, completed_pomos, sort_order,
  completed_at, deleted_at, created_at, updated_at`;

export async function getTask(id: string): Promise<Task | null> {
  const rows = await query<unknown>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1`, [id]);
  return rows[0] ? parseTask(rows[0]) : null;
}

export async function tasksForList(listId: string): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE list_id = $1 AND deleted_at IS NULL AND parent_id IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
    [listId],
  );
  return rows.map(parseTask);
}

export async function tasksForDate(date: string, today: string): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE ${TASKS_FOR_DATE_WHERE}
     ORDER BY sort_order ASC, created_at ASC`,
    [date, today],
  );
  return rows.map(parseTask);
}

export type NewTask = {
  title: string;
  listId: string;
  sectionId: string | null;
  dueOn?: string | null;
  dueTime?: string | null;
  startOn?: string | null;
  priority?: Priority;
  important?: boolean;
  notes?: string;
  parentId?: string | null;
  recurrence?: RecurrenceRule | null;
};

export async function createTask(input: NewTask): Promise<SaveResult<Task>> {
  const title = cleanTitle(input.title);
  if ("error" in title) return { status: "error", message: title.error };
  const notes = cleanNotes(input.notes ?? "");
  if ("error" in notes) return { status: "error", message: notes.error };
  const id = crypto.randomUUID();
  if (input.parentId) {
    try {
      const links = await taskLinks();
      if (parentCreatesCycle(links, id, input.parentId)) {
        return { status: "error", message: "A task cannot contain itself." };
      }
    } catch {
      await logFailure("task save failed");
      return { status: "error", message: "Not saved" };
    }
  }
  const recurrenceJson = input.recurrence ? serializeRule(input.recurrence) : null;
  try {
    const maxRows = await query<{ max_sort: number | null }>(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM tasks WHERE list_id = $1",
      [input.listId],
    );
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    const { stamp } = await writeStamped((stamp) => [
      {
        sql: `INSERT INTO tasks (
         id, series_id, list_id, section_id, parent_id, title, notes, priority,
         important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json, estimated_pomos, completed_pomos,
         sort_order, completed_at, deleted_at, created_at, updated_at
       ) VALUES (
         $1, $1, $2, $3, $14, $4, $5, $6,
         $7, 0, 0, $8, $9, $10, NULL, $11, NULL, 0,
         $12, NULL, NULL, $13, $13
       )`,
        values: [
          id,
          input.listId,
          input.sectionId,
          title.title,
          notes.notes,
          input.priority ?? "none",
          input.important ? 1 : 0,
          input.startOn ?? null,
          input.dueOn ?? null,
          input.dueTime ?? null,
          recurrenceJson,
          sortOrder,
          stamp,
          input.parentId ?? null,
        ],
      },
    ]);
    return {
      status: "saved",
      row: {
        id,
        seriesId: id,
        listId: input.listId,
        sectionId: input.sectionId,
        parentId: input.parentId ?? null,
        title: title.title,
        notes: notes.notes,
        priority: input.priority ?? "none",
        important: input.important ?? false,
        urgent: false,
        pinned: false,
        startOn: input.startOn ?? null,
        dueOn: input.dueOn ?? null,
        dueTime: input.dueTime ?? null,
        durationMinutes: null,
        recurrenceJson,
        estimatedPomos: null,
        completedPomos: 0,
        sortOrder,
        completedAt: null,
        deletedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
    };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export type TaskPatch = {
  title?: string;
  notes?: string;
  listId?: string;
  sectionId?: string | null;
  priority?: Priority;
  important?: boolean;
  urgent?: boolean;
  pinned?: boolean;
  startOn?: string | null;
  dueOn?: string | null;
  dueTime?: string | null;
  durationMinutes?: number | null;
  estimatedPomos?: number | null;
  recurrence?: RecurrenceRule | null;
};

export async function patchTask(
  task: Task,
  patch: TaskPatch,
  force = false,
): Promise<SaveResult<Task>> {
  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if ("error" in title) return { status: "error", message: title.error };
    patch = { ...patch, title: title.title };
  }
  if (patch.notes !== undefined) {
    const notes = cleanNotes(patch.notes);
    if ("error" in notes) return { status: "error", message: notes.error };
    patch = { ...patch, notes: notes.notes };
  }
  const sets = ["updated_at = $1"];
  const values: unknown[] = [""];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.title !== undefined) add("title", patch.title);
  if (patch.notes !== undefined) add("notes", patch.notes);
  if (patch.listId !== undefined) add("list_id", patch.listId);
  if (patch.sectionId !== undefined) add("section_id", patch.sectionId);
  if (patch.priority !== undefined) add("priority", patch.priority);
  if (patch.important !== undefined) add("important", patch.important ? 1 : 0);
  if (patch.urgent !== undefined) add("urgent", patch.urgent ? 1 : 0);
  if (patch.pinned !== undefined) add("pinned", patch.pinned ? 1 : 0);
  if (patch.startOn !== undefined) add("start_on", patch.startOn);
  if (patch.dueOn !== undefined) add("due_on", patch.dueOn);
  if (patch.dueTime !== undefined) add("due_time", patch.dueTime);
  if (patch.durationMinutes !== undefined) add("duration_minutes", patch.durationMinutes);
  if (patch.estimatedPomos !== undefined) {
    if (patch.estimatedPomos !== null && (!Number.isInteger(patch.estimatedPomos) || patch.estimatedPomos < 1 || patch.estimatedPomos > 99)) {
      return { status: "error", message: "Estimated pomodoros can be 1 to 99." };
    }
    add("estimated_pomos", patch.estimatedPomos);
  }
  let recurrenceJson: string | null | undefined;
  if (patch.recurrence !== undefined) {
    if (patch.recurrence === null) {
      recurrenceJson = null;
    } else {
      const checked = parseRule(serializeRule(patch.recurrence));
      if (!checked) return { status: "error", message: "Not saved" };
      recurrenceJson = serializeRule(checked);
    }
    add("recurrence_json", recurrenceJson);
  }
  values.push(task.id);
  let sql = `UPDATE tasks SET ${sets.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL`;
  if (!force) {
    values.push(task.updatedAt);
    sql += ` AND updated_at = $${values.length}`;
  }
  const resetReminders = patch.dueOn !== undefined || patch.dueTime !== undefined;
  try {
    const saved = await withStamp(async (stamp, run) => {
      const statements: SqlStatement[] = [{ sql, values: [stamp, ...values.slice(1)] }];
      if (resetReminders) {
        statements.push({
          sql: `UPDATE reminders SET fired_at = NULL, updated_at = $1
                WHERE task_id = $2
                  AND EXISTS (SELECT 1 FROM tasks WHERE id = $2 AND deleted_at IS NULL AND updated_at = $1)`,
          values: [stamp, task.id],
        });
      }
      const result = await run(statements);
      return { stamp, affected: result.batches[0]?.rowsAffected ?? 0 };
    });
    if (saved.affected === 0) {
      return { status: "conflict", current: await getTask(task.id) };
    }
    if (patch.notes !== undefined && patch.notes !== task.notes) {
      await syncChecklistReminders(task.id, task.notes, patch.notes);
    }
    const summary = describeEdit({
      title: patch.title !== undefined && patch.title !== task.title,
      dates:
        (patch.startOn !== undefined && patch.startOn !== task.startOn) ||
        (patch.dueOn !== undefined && patch.dueOn !== task.dueOn) ||
        (patch.dueTime !== undefined && patch.dueTime !== task.dueTime),
      list: patch.listId !== undefined && patch.listId !== task.listId,
      priority: patch.priority !== undefined && patch.priority !== task.priority,
    });
    if (summary) await recordHistory(task.id, summary);
    return {
      status: "saved",
      row: {
        ...task,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.listId !== undefined ? { listId: patch.listId } : {}),
        ...(patch.sectionId !== undefined ? { sectionId: patch.sectionId } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.important !== undefined ? { important: patch.important } : {}),
        ...(patch.urgent !== undefined ? { urgent: patch.urgent } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.startOn !== undefined ? { startOn: patch.startOn } : {}),
        ...(patch.dueOn !== undefined ? { dueOn: patch.dueOn } : {}),
        ...(patch.dueTime !== undefined ? { dueTime: patch.dueTime } : {}),
        ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
        ...(patch.estimatedPomos !== undefined ? { estimatedPomos: patch.estimatedPomos } : {}),
        ...(recurrenceJson !== undefined ? { recurrenceJson } : {}),
        updatedAt: saved.stamp,
      },
    };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

/** A clock value is this call's post-lock stamp. Null clears the column and still stamps updated_at. */
async function stampTask(id: string, column: "completed_at" | "deleted_at", value: "clock" | null): Promise<SaveResult<Task>> {
  try {
    const { batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE tasks SET ${column} = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL`,
        values: [value === "clock" ? stamp : null, stamp, id],
      },
    ]);
    const current = await getTask(id);
    if ((batches[0]?.rowsAffected ?? 0) === 0 || !current) return { status: "conflict", current };
    return { status: "saved", row: current };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function completeTask(id: string): Promise<SaveResult<Task>> {
  const current = await getTask(id);
  if (!current || current.deletedAt || current.completedAt) {
    return stampTask(id, "completed_at", "clock");
  }
  const completed = await stampTask(id, "completed_at", "clock");
  if (completed.status !== "saved") return completed;
  await recordHistory(id, "Completed");
  const spawned = await spawnNextOccurrence(current);
  if (spawned === "error") {
    await logFailure("next occurrence save failed");
    return { status: "error", message: "Not saved" };
  }
  return completed;
}

async function spawnNextOccurrence(current: Task): Promise<"none" | "saved" | "error"> {
  if (!current.recurrenceJson || !parseRule(current.recurrenceJson)) return "none";
  try {
    const [tagRows, reminderRows, checklistRows] = await Promise.all([
      query<{ tag_id: string }>(`SELECT tag_id FROM task_tags WHERE task_id = $1`, [current.id]),
      query<{ minutes_before: number | string }>(`SELECT minutes_before FROM reminders WHERE task_id = $1`, [current.id]),
      query<{ line_text: string; due_on: string; due_time: string | null; minutes_before: number | string }>(
        `SELECT line_text, due_on, due_time, minutes_before FROM checklist_reminders WHERE task_id = $1`,
        [current.id],
      ),
    ]);
    const draft = nextOccurrenceDraft(
      {
        seriesId: current.seriesId,
        listId: current.listId,
        sectionId: current.sectionId,
        parentId: current.parentId,
        title: current.title,
        notes: current.notes,
        priority: current.priority,
        important: current.important,
        urgent: current.urgent,
        pinned: current.pinned,
        startOn: current.startOn,
        dueOn: current.dueOn,
        dueTime: current.dueTime,
        durationMinutes: current.durationMinutes,
        estimatedPomos: current.estimatedPomos,
        recurrenceJson: current.recurrenceJson,
        tagIds: tagRows.map((row) => row.tag_id),
        reminderOffsets: reminderRows.map((row) => Number(row.minutes_before)),
        checklistReminders: checklistRows.map((row) => ({
          lineText: row.line_text,
          dueOn: row.due_on,
          dueTime: row.due_time,
          minutesBefore: Number(row.minutes_before),
        })),
      },
      Temporal.Now.plainDateISO().toString(),
    );
    if (!draft) return "none";
    const id = crypto.randomUUID();
    const maxRows = await query<{ max_sort: number | null }>(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM tasks WHERE list_id = $1",
      [current.listId],
    );
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    await writeStamped((stamp) => {
      const statements: SqlStatement[] = [
        {
          sql: `INSERT INTO tasks (
         id, series_id, list_id, section_id, parent_id, title, notes, priority,
         important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json, estimated_pomos, completed_pomos,
         sort_order, completed_at, deleted_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16, $19, 0,
         $17, NULL, NULL, $18, $18
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
            sortOrder,
            stamp,
            draft.estimatedPomos,
          ],
        },
      ];
      for (const tagId of draft.tagIds) {
        statements.push({ sql: `INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)`, values: [id, tagId] });
      }
      for (const minutes of draft.reminderOffsets) {
        statements.push({
          sql: `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, $4)`,
          values: [crypto.randomUUID(), id, minutes, stamp],
        });
      }
      for (const row of draft.checklistReminders) {
        statements.push({
          sql: `INSERT INTO checklist_reminders (
           id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          values: [crypto.randomUUID(), id, row.lineText, row.dueOn, row.dueTime, row.minutesBefore, row.firedAt, stamp],
        });
      }
      return statements;
    });
    return "saved";
  } catch {
    return "error";
  }
}

export async function tasksUpcoming(today: string): Promise<Task[]> {
  const end = addDays(today, 7);
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE deleted_at IS NULL AND parent_id IS NULL AND completed_at IS NULL
       AND due_on IS NOT NULL AND (due_on < $1 OR (due_on > $1 AND due_on <= $2))
     ORDER BY due_on ASC, due_time ASC, sort_order ASC`,
    [today, end],
  );
  return rows.map(parseTask);
}

export async function tasksInRange(from: string, to: string): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE deleted_at IS NULL AND parent_id IS NULL AND completed_at IS NULL
       AND due_on IS NOT NULL AND due_on >= $1 AND due_on <= $2
     ORDER BY due_on ASC, due_time ASC, sort_order ASC`,
    [from, to],
  );
  return rows.map(parseTask);
}

export async function reopenTask(id: string): Promise<SaveResult<Task>> {
  const current = await getTask(id);
  const result = await stampTask(id, "completed_at", null);
  if (result.status === "saved" && current?.completedAt) await recordHistory(id, "Reopened");
  return result;
}

export async function trashTask(id: string): Promise<SaveResult<Task>> {
  const current = await getTask(id);
  try {
    const { batches } = await writeStamped((stamp) => {
      const statements: SqlStatement[] = [];
      if (current) {
        statements.push({
          sql: `UPDATE tasks SET parent_id = NULL, list_id = $1, section_id = $2, updated_at = $3
         WHERE parent_id = $4 AND deleted_at IS NULL`,
          values: [current.listId, current.sectionId, stamp, id],
        });
      }
      statements.push({
        sql: `UPDATE tasks SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL`,
        values: [stamp, id],
      });
      return statements;
    });
    const affected = batches[batches.length - 1]?.rowsAffected ?? 0;
    const row = await getTask(id);
    if (affected === 0 || !row) return { status: "conflict", current: row };
    return { status: "saved", row };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function childCount(id: string): Promise<number> {
  const rows = await query<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM tasks WHERE parent_id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function tasksPresent(): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE deleted_at IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
  );
  return rows.map(parseTask);
}

async function taskLinks(): Promise<SubtaskLink[]> {
  const rows = await query<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM tasks WHERE deleted_at IS NULL`,
  );
  return rows.map((row) => ({ id: row.id, parentId: row.parent_id }));
}

export async function directChildCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const link of await taskLinks()) {
    if (!link.parentId) continue;
    counts.set(link.parentId, (counts.get(link.parentId) ?? 0) + 1);
  }
  return counts;
}

export async function tasksForParent(parentId: string): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE parent_id = $1 AND deleted_at IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
    [parentId],
  );
  return rows.map(parseTask);
}

/** One updated_at for the whole call, so a later sync can see the new order. */
export async function rewriteOrder(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await writeStamped((stamp) =>
    ids.map((id, index) => ({
      sql: `UPDATE tasks SET sort_order = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL`,
      values: [index, stamp, id],
    })),
  );
}

/** Section change and destination order in one transaction. Does not complete or reopen. */
export async function moveTaskOnBoard(
  taskId: string,
  sectionId: string,
  orderedIds: string[] | null,
): Promise<SaveResult<{ id: string }>> {
  try {
    await withStamp(async (stamp, run) => {
      if (!orderedIds) {
        await run([
          {
            sql: `UPDATE tasks SET section_id = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL`,
            values: [sectionId, stamp, taskId],
          },
        ]);
        return;
      }
      await run(
        orderedIds.map((id, index) =>
          id === taskId
            ? {
                sql: `UPDATE tasks SET section_id = $1, sort_order = $2, updated_at = $3 WHERE id = $4 AND deleted_at IS NULL`,
                values: [sectionId, index, stamp, id],
              }
            : {
                sql: `UPDATE tasks SET sort_order = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL`,
                values: [index, stamp, id],
              },
        ),
      );
    });
    return { status: "saved", row: { id: taskId } };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function tasksOpen(): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE deleted_at IS NULL AND parent_id IS NULL AND completed_at IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
  );
  return rows.map(parseTask);
}

export async function tasksForTimeline(): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE deleted_at IS NULL AND completed_at IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
  );
  return rows.map(parseTask);
}

export async function tasksForPlanner(): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE deleted_at IS NULL AND parent_id IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
  );
  return rows.map(parseTask);
}

export async function trashedTasks(): Promise<Task[]> {
  const rows = await query<unknown>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
  );
  return rows.map(parseTask);
}

export async function restoreTask(id: string): Promise<SaveResult<Task>> {
  try {
    const { batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE tasks SET deleted_at = NULL, updated_at = $1 WHERE id = $2 AND deleted_at IS NOT NULL`,
        values: [stamp, id],
      },
    ]);
    const current = await getTask(id);
    if ((batches[0]?.rowsAffected ?? 0) === 0 || !current) return { status: "conflict", current };
    return { status: "saved", row: current };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function purgeTask(id: string): Promise<SaveResult<{ id: string }>> {
  try {
    const rows = await query<{ id: string }>(`SELECT id FROM tasks WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
    if (rows.length === 0) return { status: "error", message: "Not saved" };
    const files = await attachmentIdsForTasks([id]);
    await writeStamped((stamp) => [
      deletionStatement("tasks", id, stamp),
      { sql: `DELETE FROM tasks WHERE id = $1 AND deleted_at IS NOT NULL`, values: [id] },
    ]);
    await dropStoredFiles(files);
    return { status: "saved", row: { id } };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function emptyTrash(): Promise<SaveResult<{ id: string }>> {
  try {
    const ids = await query<{ id: string }>(`SELECT id FROM tasks WHERE deleted_at IS NOT NULL`);
    const files = await trashedAttachmentIds();
    await writeStamped((stamp) => [
      ...ids.map((row) => deletionStatement("tasks", row.id, stamp)),
      { sql: `DELETE FROM tasks WHERE deleted_at IS NOT NULL` },
    ]);
    await dropStoredFiles(files);
    return { status: "saved", row: { id: "trash" } };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function completedInstants(fromInstant: string, toInstant: string): Promise<string[]> {
  const rows = await query<{ completed_at: string }>(
    `SELECT completed_at FROM tasks
     WHERE deleted_at IS NULL AND completed_at IS NOT NULL AND completed_at >= $1 AND completed_at <= $2`,
    [fromInstant, toInstant],
  );
  return rows.map((row) => row.completed_at);
}
