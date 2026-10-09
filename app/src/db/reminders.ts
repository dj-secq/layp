import { z } from "zod";
import { logFailure, query, withStamp, writeStamped } from "./client";
import { recordDeletion } from "./deletions";
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
    await writeStamped((stamp) => [
      {
        sql: `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, $4)`,
        values: [id, taskId, minutesBefore, stamp],
      },
    ]);
    return { status: "saved", row: { id, minutesBefore } };
  } catch {
    await logFailure("reminder failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function removeReminder(id: string): Promise<SaveResult<{ id: string }>> {
  const rows = await query<{ id: string }>(`SELECT id FROM reminders WHERE id = $1`, [id]);
  if (rows.length === 0) return { status: "error", message: "Not saved" };
  try {
    await withStamp(async (stamp, run) => {
      await recordDeletion("reminders", id, stamp, run, [
        { sql: `DELETE FROM reminders WHERE id = $1`, values: [id] },
      ]);
    });
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
  const marks = ids.map((_, index) => `$${index + 2}`).join(", ");
  await writeStamped((stamp) => {
    const values = [stamp, ...ids];
    return [
      {
        sql: `UPDATE reminders SET fired_at = $1, updated_at = $1 WHERE fired_at IS NULL AND id IN (${marks})`,
        values,
      },
      {
        sql: `UPDATE checklist_reminders SET fired_at = $1, updated_at = $1 WHERE fired_at IS NULL AND id IN (${marks})`,
        values,
      },
    ];
  });
}
