import { cleanDate, cleanListName, countdownSchema, type Countdown } from "@layp/shared";
import { logFailure, query, withStamp, writeStamped } from "./client";
import { recordDeletion } from "./deletions";
import type { SaveResult } from "./types";

export type { Countdown };

export async function loadCountdowns(): Promise<Countdown[]> {
  const rows = await query<unknown>(
    `SELECT id, title, target_on, sort_order, created_at, updated_at FROM countdowns ORDER BY sort_order ASC, target_on ASC`,
  );
  return rows.map((row) => countdownSchema.parse(row));
}

export async function createCountdown(titleInput: string, targetInput: string): Promise<SaveResult<Countdown>> {
  const cleaned = cleanListName(titleInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const targetOn = cleanDate(targetInput);
  if (!targetOn) return { status: "error", message: "Add a date." };
  const id = crypto.randomUUID();
  try {
    const maxRows = await query<{ max_sort: number | null }>(`SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM countdowns`);
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    const { stamp } = await writeStamped((stamp) => [
      {
        sql: `INSERT INTO countdowns (id, title, target_on, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
        values: [id, cleaned.name, targetOn, sortOrder, stamp],
      },
    ]);
    return {
      status: "saved",
      row: { id, title: cleaned.name, targetOn, sortOrder, createdAt: stamp, updatedAt: stamp },
    };
  } catch {
    await logFailure("countdown save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function updateCountdown(
  countdown: Countdown,
  titleInput: string,
  targetInput: string,
): Promise<SaveResult<Countdown>> {
  const cleaned = cleanListName(titleInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const targetOn = cleanDate(targetInput);
  if (!targetOn) return { status: "error", message: "Add a date." };
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE countdowns SET title = $1, target_on = $2, updated_at = $3 WHERE id = $4`,
        values: [cleaned.name, targetOn, stamp, countdown.id],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...countdown, title: cleaned.name, targetOn, updatedAt: stamp } };
  } catch {
    await logFailure("countdown save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function deleteCountdown(id: string): Promise<void> {
  const existing = await query<{ id: string }>(`SELECT id FROM countdowns WHERE id = $1`, [id]);
  if (existing.length === 0) return;
  await withStamp(async (stamp, run) => {
    await recordDeletion("countdowns", id, stamp, run, [
      { sql: `DELETE FROM countdowns WHERE id = $1`, values: [id] },
    ]);
  });
}
