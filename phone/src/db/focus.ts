import { addDays, clampPomoMinutes, pausedOnLaunch, type TimerSnapshot } from "@layp/shared";
import { randomUUID } from "../link/random";
import { withLock, withStamp } from "./lock";
import type { Run, SqlStatement } from "./sql";

export type FocusSession = { endedAt: string; minutes: number; taskId: string | null };

function localCivilDay(instant: string): string | null {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A UTC window wide enough that every local civil day in the range is included. */
function instantWindow(from: string, to: string): [string, string] {
  return [`${addDays(from, -1)}T00:00:00.000Z`, `${addDays(to, 2)}T00:00:00.000Z`];
}

export async function loadTimer(workMinutes: number): Promise<TimerSnapshot> {
  const seconds = clampPomoMinutes(workMinutes) * 60;
  const loaded = await withLock(async (run) => {
    const rows = await run([
      { sql: `SELECT task_id, phase, running, remaining_seconds FROM timer_state WHERE id = 1`, values: [] },
    ]);
    const row = rows.batches[0]?.rows[0];
    const fallback: TimerSnapshot = { taskId: null, phase: "idle", running: false, remainingSeconds: seconds };
    if (!row) return fallback;
    const phase = row.phase === "work" || row.phase === "break" || row.phase === "idle" ? row.phase : null;
    if (!phase) return fallback;
    const remaining = Number(row.remaining_seconds);
    const timer: TimerSnapshot = {
      taskId: typeof row.task_id === "string" ? row.task_id : null,
      phase,
      running: row.running === true || row.running === 1 || row.running === "1",
      remainingSeconds: Number.isFinite(remaining) ? Math.max(0, remaining) : seconds,
    };
    return timer;
  });
  const paused = pausedOnLaunch(loaded);
  if (loaded.running) await saveTimer(paused);
  return paused;
}

export async function writeTimer(run: Run, timer: TimerSnapshot, stamp: string): Promise<void> {
  await run([
    {
      sql: `INSERT INTO timer_state (id, task_id, phase, running, remaining_seconds, updated_at)
            VALUES (1, $1, $2, $3, $4, $5)
            ON CONFLICT(id) DO UPDATE SET
              task_id = excluded.task_id,
              phase = excluded.phase,
              running = excluded.running,
              remaining_seconds = excluded.remaining_seconds,
              updated_at = excluded.updated_at`,
      values: [timer.taskId, timer.phase, timer.running ? 1 : 0, Math.max(0, Math.floor(timer.remainingSeconds)), stamp],
    },
  ]);
}

export async function saveTimer(timer: TimerSnapshot): Promise<void> {
  try {
    await withStamp((stamp, run) => writeTimer(run, timer, stamp));
  } catch {
    // The timer is local. A failed save leaves the on-screen time in place.
  }
}

export async function recordFocusOn(
  run: Run,
  taskId: string | null,
  minutes: number,
  stamp: string,
  id: string,
  endedAt: string,
): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 1) return;
  const startedAt = new Date(new Date(endedAt).getTime() - minutes * 60_000).toISOString();
  const statements: SqlStatement[] = [
    {
      sql: `INSERT INTO focus_sessions (id, task_id, started_at, ended_at, minutes, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      values: [id, taskId, startedAt, endedAt, minutes, stamp],
    },
  ];
  if (taskId) {
    statements.push({
      sql: `UPDATE tasks SET completed_pomos = completed_pomos + 1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL`,
      values: [stamp, taskId],
    });
  }
  await run(statements);
}

export async function recordFocus(taskId: string | null, minutes: number): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 1) return;
  try {
    await withStamp((stamp, run) => recordFocusOn(run, taskId, minutes, stamp, randomUUID(), new Date().toISOString()));
  } catch {
    // The block already finished on screen. The next sync sends whatever did save.
  }
}

async function readSessions(run: Run, from: string, to: string): Promise<FocusSession[]> {
  const [start, end] = instantWindow(from, to);
  const loaded = await run([
    {
      sql: `SELECT ended_at, minutes, task_id FROM focus_sessions WHERE ended_at >= $1 AND ended_at < $2 ORDER BY ended_at ASC`,
      values: [start, end],
    },
  ]);
  const sessions: FocusSession[] = [];
  for (const row of loaded.batches[0]?.rows ?? []) {
    if (typeof row.ended_at !== "string") continue;
    const day = localCivilDay(row.ended_at);
    if (!day || day < from || day > to) continue;
    const minutes = Number(row.minutes);
    if (!Number.isFinite(minutes)) continue;
    sessions.push({ endedAt: row.ended_at, minutes, taskId: typeof row.task_id === "string" ? row.task_id : null });
  }
  return sessions;
}

export function sessionsOnDay(day: string): Promise<FocusSession[]> {
  return withLock((run) => readSessions(run, day, day));
}

export function sessionMinutesBetween(from: string, to: string): Promise<Array<{ day: string; minutes: number }>> {
  return withLock(async (run) => {
    const sessions = await readSessions(run, from, to);
    return sessions.flatMap((session) => {
      const day = localCivilDay(session.endedAt);
      return day ? [{ day, minutes: session.minutes }] : [];
    });
  });
}

/** One civil day per completed task, with duplicates when several tasks finish on the same day. */
export function completionsBetween(from: string, to: string): Promise<string[]> {
  return withLock(async (run) => {
    const [start, end] = instantWindow(from, to);
    const loaded = await run([
      {
        sql: `SELECT completed_at FROM tasks
              WHERE completed_at IS NOT NULL AND deleted_at IS NULL
                AND completed_at >= $1 AND completed_at < $2`,
        values: [start, end],
      },
    ]);
    const days: string[] = [];
    for (const row of loaded.batches[0]?.rows ?? []) {
      if (typeof row.completed_at !== "string") continue;
      const day = localCivilDay(row.completed_at);
      if (day && day >= from && day <= to) days.push(day);
    }
    return days;
  });
}
