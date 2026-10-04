import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { nowIso } from "../lib/clock";
import { pausedOnLaunch, type TimerPhase, type TimerSnapshot } from "../lib/pomo";
import { logFailure, query, run } from "./client";

const phase = z.enum(["idle", "work", "break"]);

const rowSchema = z.object({
  task_id: z.string().nullish(),
  phase,
  running: z.union([z.number(), z.string(), z.boolean()]),
  remaining_seconds: z.union([z.number(), z.string()]),
});

export async function loadTimer(workMinutes: number): Promise<TimerSnapshot> {
  const rows = await query<unknown>(`SELECT task_id, phase, running, remaining_seconds FROM timer_state WHERE id = 1`);
  const row = rows[0] ? rowSchema.parse(rows[0]) : null;
  if (!row) return pausedOnLaunch({ taskId: null, phase: "idle", running: false, remainingSeconds: workMinutes * 60 });
  const timer: TimerSnapshot = {
    taskId: row.task_id ?? null,
    phase: row.phase as TimerPhase,
    running: row.running === true || row.running === 1 || row.running === "1",
    remainingSeconds: Math.max(0, Number(row.remaining_seconds)),
  };
  const paused = pausedOnLaunch(timer);
  if (timer.running) await saveTimer(paused);
  return paused;
}

export async function saveTimer(timer: TimerSnapshot): Promise<void> {
  try {
    await run(
      `INSERT INTO timer_state (id, task_id, phase, running, remaining_seconds, updated_at)
       VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT(id) DO UPDATE SET
         task_id = excluded.task_id,
         phase = excluded.phase,
         running = excluded.running,
         remaining_seconds = excluded.remaining_seconds,
         updated_at = excluded.updated_at`,
      [timer.taskId, timer.phase, timer.running ? 1 : 0, Math.max(0, Math.floor(timer.remainingSeconds)), nowIso()],
    );
  } catch {
    await logFailure("timer save failed");
  }
}

export async function recordFocus(taskId: string | null, minutes: number): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 1) return;
  const ended = Temporal.Now.instant();
  const started = ended.subtract({ minutes });
  try {
    await run(
      `INSERT INTO focus_sessions (id, task_id, started_at, ended_at, minutes) VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), taskId, started.toString(), ended.toString(), minutes],
    );
    if (taskId) {
      await run(`UPDATE tasks SET completed_pomos = completed_pomos + 1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL`, [
        nowIso(),
        taskId,
      ]);
    }
  } catch {
    await logFailure("focus save failed");
  }
}

export async function sessionsBetween(fromInstant: string, toInstant: string): Promise<Array<{ endedAt: string; minutes: number; taskId: string | null }>> {
  const rows = await query<{ ended_at: string; minutes: number | string; task_id: string | null }>(
    `SELECT ended_at, minutes, task_id FROM focus_sessions WHERE ended_at >= $1 AND ended_at <= $2 ORDER BY ended_at ASC`,
    [fromInstant, toInstant],
  );
  return rows.map((row) => ({ endedAt: row.ended_at, minutes: Number(row.minutes), taskId: row.task_id }));
}
