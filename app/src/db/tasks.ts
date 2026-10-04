import { Temporal } from "temporal-polyfill";
import { nowIso } from "../lib/clock";
import { addDays } from "../lib/dates";
import { anchorDate, nextDueDate, parseRule, ruleAfterComplete, serializeRule, type RecurrenceRule } from "../lib/recur";
import { describeEdit } from "../lib/planner";
import { parentCreatesCycle, type SubtaskLink } from "../lib/subtasks";
import { cleanNotes, cleanTitle } from "../lib/validate";
import { attachmentIdsForTasks, dropStoredFiles, trashedAttachmentIds } from "./attachments";
import { copyChecklistReminders, syncChecklistReminders } from "./checklistReminders";
import { logFailure, query, run } from "./client";
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
     WHERE deleted_at IS NULL AND parent_id IS NULL
       AND list_id IN (SELECT id FROM lists WHERE archived_at IS NULL)
       AND (
         due_on = $1
         OR start_on = $1
         OR ($1 = $2 AND completed_at IS NULL AND pinned = 1)
         OR ($1 = $2 AND completed_at IS NULL AND due_on IS NOT NULL AND due_on < $2)
       )
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
  const stamp = nowIso();
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
  const task: Task = {
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
    recurrenceJson: input.recurrence ? serializeRule(input.recurrence) : null,
    estimatedPomos: null,
    completedPomos: 0,
    sortOrder: 0,
    completedAt: null,
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  try {
    const maxRows = await query<{ max_sort: number | null }>(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM tasks WHERE list_id = $1",
      [input.listId],
    );
    task.sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    await run(
      `INSERT INTO tasks (
         id, series_id, list_id, section_id, parent_id, title, notes, priority,
         important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json, estimated_pomos, completed_pomos,
         sort_order, completed_at, deleted_at, created_at, updated_at
       ) VALUES (
         $1, $1, $2, $3, $14, $4, $5, $6,
         $7, 0, 0, $8, $9, $10, NULL, $11, NULL, 0,
         $12, NULL, NULL, $13, $13
       )`,
      [
        id,
        task.listId,
        task.sectionId,
        task.title,
        task.notes,
        task.priority,
        task.important ? 1 : 0,
        task.startOn,
        task.dueOn,
        task.dueTime,
        task.recurrenceJson,
        task.sortOrder,
        stamp,
        task.parentId,
      ],
    );
    return { status: "saved", row: task };
  } catch (err) {
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
  const stamp = nowIso();
  const values: unknown[] = [stamp];
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
  values.push(task.id);
  let sql = `UPDATE tasks SET ${sets.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL`;
  if (!force) {
    values.push(task.updatedAt);
    sql += ` AND updated_at = $${values.length}`;
  }
  try {
    const affected = await run(sql, values);
    if (affected === 0) {
      return { status: "conflict", current: await getTask(task.id) };
    }
    if (patch.dueOn !== undefined || patch.dueTime !== undefined) {
      await run(`UPDATE reminders SET fired_at = NULL WHERE task_id = $1`, [task.id]);
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
        ...patch,
        updatedAt: stamp,
      },
    };
  } catch (err) {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

async function stampTask(id: string, column: "completed_at" | "deleted_at", value: string | null): Promise<SaveResult<Task>> {
  const stamp = nowIso();
  try {
    const affected = await run(
      `UPDATE tasks SET ${column} = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL`,
      [value, stamp, id],
    );
    const current = await getTask(id);
    if (affected === 0 || !current) return { status: "conflict", current };
    return { status: "saved", row: current };
  } catch (err) {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function completeTask(id: string): Promise<SaveResult<Task>> {
  const current = await getTask(id);
  if (!current || current.deletedAt || current.completedAt) {
    return stampTask(id, "completed_at", nowIso());
  }
  const completed = await stampTask(id, "completed_at", nowIso());
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
  const parsed = current.recurrenceJson ? parseRule(current.recurrenceJson) : null;
  if (!parsed) return "none";
  const anchor = anchorDate(parsed, current.dueOn, Temporal.Now.plainDateISO().toString());
  if (!anchor) return "none";
  const dueOn = nextDueDate(parsed, anchor);
  const nextRule = dueOn ? ruleAfterComplete(parsed) : null;
  if (!dueOn || !nextRule) return "none";
  const id = crypto.randomUUID();
  const stamp = nowIso();
  const startOn = current.startOn && current.dueOn ? shiftStart(current.startOn, current.dueOn, dueOn) : null;
  try {
    const maxRows = await query<{ max_sort: number | null }>(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM tasks WHERE list_id = $1",
      [current.listId],
    );
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    await run(
      `INSERT INTO tasks (
         id, series_id, list_id, section_id, parent_id, title, notes, priority,
         important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json, estimated_pomos, completed_pomos,
         sort_order, completed_at, deleted_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16, $19, 0,
         $17, NULL, NULL, $18, $18
       )`,
      [
        id,
        current.seriesId,
        current.listId,
        current.sectionId,
        current.parentId,
        current.title,
        current.notes,
        current.priority,
        current.important ? 1 : 0,
        current.urgent ? 1 : 0,
        current.pinned ? 1 : 0,
        startOn,
        dueOn,
        current.dueTime,
        current.durationMinutes,
        serializeRule(nextRule),
        sortOrder,
        stamp,
        current.estimatedPomos,
      ],
    );
    await run(
      `INSERT INTO task_tags (task_id, tag_id)
       SELECT $1, tag_id FROM task_tags WHERE task_id = $2`,
      [id, current.id],
    );
    const reminders = await query<{ minutes_before: number }>(
      `SELECT minutes_before FROM reminders WHERE task_id = $1`,
      [current.id],
    );
    for (const reminder of reminders) {
      await run(
        `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at) VALUES ($1, $2, $3, NULL, $4)`,
        [crypto.randomUUID(), id, reminder.minutes_before, stamp],
      );
    }
    await copyChecklistReminders(current.id, id, stamp);
    return "saved";
  } catch (err) {
    await run("DELETE FROM tasks WHERE id = $1", [id]).catch(() => undefined);
    return "error";
  }
}

function shiftStart(startOn: string, dueOn: string, nextDue: string): string {
  const start = Temporal.PlainDate.from(startOn);
  const due = Temporal.PlainDate.from(dueOn);
  const next = Temporal.PlainDate.from(nextDue);
  const days = start.until(due, { largestUnit: "days" }).days;
  return addDays(next.toString(), -days);
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
  if (current) {
    try {
      await run(
        `UPDATE tasks SET parent_id = NULL, list_id = $1, section_id = $2, updated_at = $3
         WHERE parent_id = $4 AND deleted_at IS NULL`,
        [current.listId, current.sectionId, nowIso(), id],
      );
    } catch {
      await logFailure("task save failed");
      return { status: "error", message: "Not saved" };
    }
  }
  return stampTask(id, "deleted_at", nowIso());
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

export async function rewriteOrder(ids: string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await run(`UPDATE tasks SET sort_order = $1 WHERE id = $2 AND deleted_at IS NULL`, [index, ids[index]]);
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
  const stamp = nowIso();
  try {
    const affected = await run(
      `UPDATE tasks SET deleted_at = NULL, updated_at = $1 WHERE id = $2 AND deleted_at IS NOT NULL`,
      [stamp, id],
    );
    const current = await getTask(id);
    if (affected === 0 || !current) return { status: "conflict", current };
    return { status: "saved", row: current };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function purgeTask(id: string): Promise<SaveResult<{ id: string }>> {
  try {
    const files = await attachmentIdsForTasks([id]);
    const affected = await run(`DELETE FROM tasks WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
    if (affected === 0) return { status: "error", message: "Not saved" };
    await dropStoredFiles(files);
    return { status: "saved", row: { id } };
  } catch {
    await logFailure("task save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function emptyTrash(): Promise<SaveResult<{ id: string }>> {
  try {
    const files = await trashedAttachmentIds();
    await run(`DELETE FROM tasks WHERE deleted_at IS NOT NULL`);
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
