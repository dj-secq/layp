import { z } from "zod";
import { nowIso } from "../lib/clock";
import { logFailure, query, run } from "./client";
import type { SaveResult } from "./types";

const count = z.union([z.number(), z.string()]).transform((value) => Number(value));

const openRow = z.object({
  id: z.string(),
  task_id: z.string(),
  title: z.string(),
  list_name: z.string(),
  due_on: z.string(),
  due_time: z.string().nullish().transform((value) => value ?? null),
  minutes_before: count,
});

const taskRow = z.object({
  id: z.string(),
  minutes_before: count,
});

export type OpenReminder = {
  id: string;
  taskId: string;
  title: string;
  listName: string;
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
};

export type TaskReminder = {
  id: string;
  minutesBefore: number;
};

export async function loadUnfiredReminders(): Promise<OpenReminder[]> {
  const rows = await query<unknown>(
    `SELECT r.id, r.task_id, t.title, l.name AS list_name, t.due_on, t.due_time, r.minutes_before
     FROM reminders r
     JOIN tasks t ON t.id = r.task_id
     JOIN lists l ON l.id = t.list_id
     WHERE r.fired_at IS NULL
       AND t.completed_at IS NULL
       AND t.deleted_at IS NULL
       AND t.due_on IS NOT NULL
     ORDER BY t.due_on ASC, t.due_time ASC, r.minutes_before ASC`,
  );
  return rows.map((row) => {
    const parsed = openRow.parse(row);
    return {
      id: parsed.id,
      taskId: parsed.task_id,
      title: parsed.title,
      listName: parsed.list_name,
      dueOn: parsed.due_on,
      dueTime: parsed.due_time,
      minutesBefore: parsed.minutes_before,
    };
  });
}

export async function remindersForTask(taskId: string): Promise<TaskReminder[]> {
  const rows = await query<unknown>(
    `SELECT id, minutes_before FROM reminders WHERE task_id = $1 ORDER BY minutes_before ASC, created_at ASC`,
    [taskId],
  );
  return rows.map((row) => {
    const parsed = taskRow.parse(row);
    return { id: parsed.id, minutesBefore: parsed.minutes_before };
  });
}

export async function addReminder(taskId: string, minutesBefore: number): Promise<SaveResult<TaskReminder>> {
  if (!Number.isInteger(minutesBefore) || minutesBefore < 0 || minutesBefore > 10080) {
    return { status: "error", message: "Use 0 to 10080 minutes." };
  }
  try {
    const tasks = await query<{ due_on: string | null }>(
      `SELECT due_on FROM tasks WHERE id = $1 AND deleted_at IS NULL`,
      [taskId],
    );
    const task = tasks[0];
    if (!task) return { status: "error", message: "Not saved" };
    if (!task.due_on) return { status: "error", message: "Add a due date to set a reminder." };
    const existing = await remindersForTask(taskId);
    if (existing.some((row) => row.minutesBefore === minutesBefore)) {
      return { status: "error", message: "That reminder is already set." };
    }
    if (existing.length >= 10) return { status: "error", message: "A task can have 10 reminders." };
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at) VALUES ($1, $2, $3, NULL, $4)`,
      [id, taskId, minutesBefore, nowIso()],
    );
    return { status: "saved", row: { id, minutesBefore } };
  } catch {
    await logFailure("reminder failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function removeReminder(id: string): Promise<SaveResult<{ id: string }>> {
  try {
    const affected = await run(`DELETE FROM reminders WHERE id = $1`, [id]);
    if (affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id } };
  } catch {
    await logFailure("reminder failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function loadUnfiredChecklistReminders(): Promise<OpenReminder[]> {
  const rows = await query<unknown>(
    `SELECT r.id, r.task_id, r.line_text AS title, l.name AS list_name, r.due_on, r.due_time, r.minutes_before
     FROM checklist_reminders r
     JOIN tasks t ON t.id = r.task_id
     JOIN lists l ON l.id = t.list_id
     WHERE r.fired_at IS NULL
       AND t.completed_at IS NULL
       AND t.deleted_at IS NULL`,
  );
  return rows.map((row) => {
    const parsed = openRow.parse(row);
    return {
      id: parsed.id,
      taskId: parsed.task_id,
      title: parsed.title,
      listName: parsed.list_name,
      dueOn: parsed.due_on,
      dueTime: parsed.due_time,
      minutesBefore: parsed.minutes_before,
    };
  });
}

export async function markFired(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const stamp = nowIso();
  const marks = ids.map((_, index) => `$${index + 2}`).join(", ");
  const values: unknown[] = [stamp, ...ids];
  await run(`UPDATE reminders SET fired_at = $1 WHERE fired_at IS NULL AND id IN (${marks})`, values);
  await run(`UPDATE checklist_reminders SET fired_at = $1 WHERE fired_at IS NULL AND id IN (${marks})`, values);
}
