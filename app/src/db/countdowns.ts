import { z } from "zod";
import { nowIso } from "../lib/clock";
import { cleanListName, cleanDate } from "../lib/validate";
import { logFailure, query, run } from "./client";
import type { SaveResult } from "./types";

const rowSchema = z.object({
  id: z.string(),
  title: z.string(),
  target_on: z.string(),
  sort_order: z.union([z.number(), z.string()]).transform((value) => Number(value)),
});

export type Countdown = { id: string; title: string; targetOn: string; sortOrder: number };

export async function loadCountdowns(): Promise<Countdown[]> {
  const rows = await query<unknown>(`SELECT id, title, target_on, sort_order FROM countdowns ORDER BY sort_order ASC, target_on ASC`);
  return rows.map((row) => {
    const parsed = rowSchema.parse(row);
    return { id: parsed.id, title: parsed.title, targetOn: parsed.target_on, sortOrder: parsed.sort_order };
  });
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
    await run(`INSERT INTO countdowns (id, title, target_on, sort_order, created_at) VALUES ($1, $2, $3, $4, $5)`, [
      id,
      cleaned.name,
      targetOn,
      sortOrder,
      nowIso(),
    ]);
    return { status: "saved", row: { id, title: cleaned.name, targetOn, sortOrder } };
  } catch {
    await logFailure("countdown save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function deleteCountdown(id: string): Promise<void> {
  await run(`DELETE FROM countdowns WHERE id = $1`, [id]);
}
