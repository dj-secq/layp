import { z } from "zod";
import { nowIso } from "../lib/clock";
import { logFailure, query, run } from "./client";

const rowSchema = z.object({
  id: z.string(),
  at: z.string(),
  summary: z.string(),
});

export type HistoryRow = { id: string; at: string; summary: string };

export async function recordHistory(taskId: string, summary: string): Promise<void> {
  const text = summary.trim().slice(0, 180);
  if (!text) return;
  try {
    await run(`INSERT INTO task_history (id, task_id, at, summary) VALUES ($1, $2, $3, $4)`, [
      crypto.randomUUID(),
      taskId,
      nowIso(),
      text,
    ]);
  } catch {
    await logFailure("history save failed");
  }
}

export async function historyForTask(taskId: string): Promise<HistoryRow[]> {
  const rows = await query<unknown>(
    `SELECT id, at, summary FROM task_history WHERE task_id = $1 ORDER BY at DESC LIMIT 50`,
    [taskId],
  );
  return rows.map((row) => rowSchema.parse(row));
}
