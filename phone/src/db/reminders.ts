import { randomUUID } from "../link/random";
import { withLock, withStamp } from "./lock";
import type { Run } from "./sql";

export type TaskReminder = { id: string; minutesBefore: number };
export type ReminderSave<T> = { status: "saved"; row: T } | { status: "error"; message: string };

export async function remindersForTask(taskId: string): Promise<TaskReminder[]> {
  return withLock((run) => remindersForTaskOn(run, taskId));
}

export async function remindersForTaskOn(run: Run, taskId: string): Promise<TaskReminder[]> {
  const loaded = await run([
    { sql: `SELECT id, minutes_before FROM reminders WHERE task_id = $1 ORDER BY minutes_before ASC, created_at ASC`, values: [taskId] },
  ]);
  return (loaded.batches[0]?.rows ?? []).flatMap((row) =>
    typeof row.id === "string" ? [{ id: row.id, minutesBefore: Number(row.minutes_before) }] : [],
  );
}

export async function addReminder(taskId: string, minutesBefore: number): Promise<ReminderSave<TaskReminder>> {
  if (!Number.isInteger(minutesBefore) || minutesBefore < 0 || minutesBefore > 10080) {
    return { status: "error", message: "Use 0 to 10080 minutes." };
  }
  try {
    return await withStamp(async (stamp, run) => addReminderOn(run, taskId, minutesBefore, stamp, randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function addReminderOn(
  run: Run,
  taskId: string,
  minutesBefore: number,
  stamp: string,
  id: string,
): Promise<ReminderSave<TaskReminder>> {
  const tasks = await run([{ sql: `SELECT due_on FROM tasks WHERE id = $1 AND deleted_at IS NULL`, values: [taskId] }]);
  const task = tasks.batches[0]?.rows[0];
  if (!task) return { status: "error", message: "Not saved" };
  if (typeof task.due_on !== "string" || task.due_on.length === 0) return { status: "error", message: "Add a due date to set a reminder." };
  const existing = await remindersForTaskOn(run, taskId);
  if (existing.some((row) => row.minutesBefore === minutesBefore)) return { status: "error", message: "That reminder is already set." };
  if (existing.length >= 10) return { status: "error", message: "A task can have 10 reminders." };
  await run([
    {
      sql: `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, $4)`,
      values: [id, taskId, minutesBefore, stamp],
    },
  ]);
  return { status: "saved", row: { id, minutesBefore } };
}

export async function removeReminder(id: string): Promise<ReminderSave<{ id: string }>> {
  try {
    const removed = await withStamp(async (stamp, run) => {
      const found = await run([{ sql: `SELECT id FROM reminders WHERE id = $1`, values: [id] }]);
      if ((found.batches[0]?.rows.length ?? 0) === 0) return false;
      await run([
        {
          sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), "reminders", id, stamp],
        },
        { sql: `DELETE FROM reminders WHERE id = $1`, values: [id] },
      ]);
      return true;
    });
    if (!removed) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}
