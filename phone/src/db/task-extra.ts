import { taskSchema, type Task } from "@layp/shared";
import { randomUUID } from "../link/random";
import { withLock, withStamp } from "./lock";
import type { Run } from "./sql";

export type ExtraSave<T> = { status: "saved"; row: T } | { status: "conflict"; current: T | null } | { status: "error"; message: string };

async function readTask(run: Run, id: string): Promise<Task | null> {
  const loaded = await run([
    {
      sql: `SELECT id, series_id, list_id, section_id, parent_id, title, notes, priority,
              important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
              estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
            FROM tasks WHERE id = $1`,
      values: [id],
    },
  ]);
  const row = loaded.batches[0]?.rows[0];
  return row ? taskSchema.parse(row) : null;
}

export function childCount(id: string): Promise<number> {
  return withLock(async (run) => {
    const loaded = await run([{ sql: `SELECT COUNT(*) AS n FROM tasks WHERE parent_id = $1 AND deleted_at IS NULL`, values: [id] }]);
    return Number(loaded.batches[0]?.rows[0]?.n ?? 0);
  });
}

export function tasksForParent(parentId: string): Promise<Task[]> {
  return withLock(async (run) => {
    const loaded = await run([
      {
        sql: `SELECT id, series_id, list_id, section_id, parent_id, title, notes, priority,
                important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
                estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
              FROM tasks WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
        values: [parentId],
      },
    ]);
    return (loaded.batches[0]?.rows ?? []).flatMap((row) => {
      const parsed = taskSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  });
}

export async function trashTask(id: string): Promise<ExtraSave<Task>> {
  try {
    return await withStamp(async (stamp, run) => {
      const current = await readTask(run, id);
      const statements = [];
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
      const saved = await run(statements);
      const affected = saved.batches[saved.batches.length - 1]?.rowsAffected ?? 0;
      const row = await readTask(run, id);
      if (affected === 0 || !row) return { status: "conflict" as const, current: row };
      return { status: "saved" as const, row };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function restoreTask(id: string): Promise<ExtraSave<Task>> {
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        { sql: `UPDATE tasks SET deleted_at = NULL, updated_at = $1 WHERE id = $2 AND deleted_at IS NOT NULL`, values: [stamp, id] },
      ]);
      const current = await readTask(run, id);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0 || !current) return { status: "conflict" as const, current };
      return { status: "saved" as const, row: current };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function purgeTask(id: string): Promise<ExtraSave<{ id: string }>> {
  try {
    const saved = await withStamp(async (stamp, run) => {
      const rows = await run([{ sql: `SELECT id FROM tasks WHERE id = $1 AND deleted_at IS NOT NULL`, values: [id] }]);
      if ((rows.batches[0]?.rows.length ?? 0) === 0) return false;
      await run([
        {
          sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), "tasks", id, stamp],
        },
        { sql: `DELETE FROM tasks WHERE id = $1 AND deleted_at IS NOT NULL`, values: [id] },
      ]);
      return true;
    });
    if (!saved) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function emptyTrash(): Promise<ExtraSave<{ id: string }>> {
  try {
    await withStamp(async (stamp, run) => {
      const ids = await run([{ sql: `SELECT id FROM tasks WHERE deleted_at IS NOT NULL`, values: [] }]);
      const statements = (ids.batches[0]?.rows ?? []).flatMap((row) =>
        typeof row.id === "string"
          ? [{
              sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
              values: [randomUUID(), "tasks", row.id, stamp],
            }]
          : [],
      );
      statements.push({ sql: `DELETE FROM tasks WHERE deleted_at IS NOT NULL`, values: [] });
      await run(statements);
    });
    return { status: "saved", row: { id: "trash" } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export function trashedTasks(): Promise<Task[]> {
  return withLock(async (run) => {
    const loaded = await run([
      {
        sql: `SELECT id, series_id, list_id, section_id, parent_id, title, notes, priority,
                important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
                estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
              FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
        values: [],
      },
    ]);
    return (loaded.batches[0]?.rows ?? []).flatMap((row) => {
      const parsed = taskSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  });
}
