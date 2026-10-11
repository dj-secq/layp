import { addDays, taskSchema, type Task } from "@layp/shared";
import { withLock } from "./lock";
import type { Run } from "./sql";
import { TASK_COLUMNS } from "./tasks";

function tasks(rows: Record<string, unknown>[]): Task[] {
  return rows.flatMap((row) => {
    const parsed = taskSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

async function readTasks(run: Run, sql: string, values: (string | number | null)[]): Promise<Task[]> {
  const loaded = await run([{ sql, values }]);
  return tasks(loaded.batches[0]?.rows ?? []);
}

const OPEN = `deleted_at IS NULL AND parent_id IS NULL`;

export function tasksForList(listId: string): Promise<Task[]> {
  return withLock((run) =>
    readTasks(
      run,
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE list_id = $1 AND ${OPEN} ORDER BY sort_order ASC, created_at ASC`,
      [listId],
    ),
  );
}

export function tasksUpcoming(today: string): Promise<Task[]> {
  return withLock((run) => tasksUpcomingOn(run, today));
}

export function tasksUpcomingOn(run: Run, today: string): Promise<Task[]> {
  return readTasks(
    run,
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE ${OPEN} AND completed_at IS NULL AND due_on IS NOT NULL
       AND (due_on < $1 OR (due_on > $1 AND due_on <= $2))
     ORDER BY due_on ASC, due_time ASC, sort_order ASC`,
    [today, addDays(today, 7)],
  );
}

export function tasksInRange(from: string, to: string): Promise<Task[]> {
  return withLock((run) =>
    readTasks(
      run,
      `SELECT ${TASK_COLUMNS} FROM tasks
       WHERE ${OPEN} AND completed_at IS NULL AND due_on IS NOT NULL AND due_on >= $1 AND due_on <= $2
       ORDER BY due_on ASC, due_time ASC, sort_order ASC`,
      [from, to],
    ),
  );
}

export function tasksOpen(): Promise<Task[]> {
  return withLock((run) =>
    readTasks(
      run,
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE ${OPEN} AND completed_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
      [],
    ),
  );
}

export function tasksForPlanner(): Promise<Task[]> {
  return withLock((run) =>
    readTasks(
      run,
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL ORDER BY sort_order ASC, created_at ASC`,
      [],
    ),
  );
}

export function tasksForTimeline(): Promise<Task[]> {
  return withLock((run) =>
    readTasks(
      run,
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE deleted_at IS NULL AND completed_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
      [],
    ),
  );
}
