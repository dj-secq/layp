import { cleanDate, cleanListName, countdownSchema, type Countdown } from "@layp/shared";
import { randomUUID } from "../link/random";
import { withLock, withStamp } from "./lock";
import type { SqlStatement } from "./sql";

export type { Countdown };
export type CountdownSave<T> = { status: "saved"; row: T } | { status: "error"; message: string };

function deletion(entityId: string, stamp: string): SqlStatement {
  return {
    sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
    values: [randomUUID(), "countdowns", entityId, stamp],
  };
}

export function loadCountdowns(): Promise<Countdown[]> {
  return withLock(async (run) => {
    const loaded = await run([
      {
        sql: `SELECT id, title, target_on, sort_order, created_at, updated_at FROM countdowns ORDER BY sort_order ASC, target_on ASC`,
        values: [],
      },
    ]);
    return (loaded.batches[0]?.rows ?? []).flatMap((row) => {
      const parsed = countdownSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  });
}

export async function createCountdown(titleInput: string, targetInput: string): Promise<CountdownSave<Countdown>> {
  const cleaned = cleanListName(titleInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const targetOn = cleanDate(targetInput);
  if (!targetOn) return { status: "error", message: "Add a date." };
  try {
    return await withStamp(async (stamp, run) => {
      const max = await run([{ sql: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM countdowns`, values: [] }]);
      const sortOrder = Number(max.batches[0]?.rows[0]?.max_sort ?? 0) + 1;
      const id = randomUUID();
      await run([
        {
          sql: `INSERT INTO countdowns (id, title, target_on, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
          values: [id, cleaned.name, targetOn, sortOrder, stamp],
        },
      ]);
      return { status: "saved" as const, row: { id, title: cleaned.name, targetOn, sortOrder, createdAt: stamp, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function updateCountdown(countdown: Countdown, titleInput: string, targetInput: string): Promise<CountdownSave<Countdown>> {
  const cleaned = cleanListName(titleInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const targetOn = cleanDate(targetInput);
  if (!targetOn) return { status: "error", message: "Add a date." };
  try {
    const saved = await withStamp(async (stamp, run) => {
      const result = await run([
        {
          sql: `UPDATE countdowns SET title = $1, target_on = $2, updated_at = $3 WHERE id = $4`,
          values: [cleaned.name, targetOn, stamp, countdown.id],
        },
      ]);
      return { stamp, affected: result.batches[0]?.rowsAffected ?? 0 };
    });
    if (saved.affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...countdown, title: cleaned.name, targetOn, updatedAt: saved.stamp } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function deleteCountdown(id: string): Promise<CountdownSave<{ id: string }>> {
  try {
    const saved = await withStamp(async (stamp, run) => {
      const rows = await run([{ sql: `SELECT id FROM countdowns WHERE id = $1`, values: [id] }]);
      if ((rows.batches[0]?.rows.length ?? 0) === 0) return false;
      await run([deletion(id, stamp), { sql: `DELETE FROM countdowns WHERE id = $1`, values: [id] }]);
      return true;
    });
    if (!saved) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}
