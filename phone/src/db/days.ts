import { daySchema, type Day } from "@layp/shared";
import { withLock, withStamp } from "./lock";
import type { Run } from "./sql";

export const DIARY_PAUSE_MS = 400;

export type DaySave =
  | { status: "saved"; row: Day }
  | { status: "conflict"; current: Day }
  | { status: "error"; message: string };

export function emptyDay(day: string): Day {
  return {
    day,
    diary: "",
    mood: null,
    sleepHours: null,
    sleepBed: null,
    sleepWake: null,
    workout: null,
    workoutNote: "",
    updatedAt: "",
  };
}

const DAY_SQL = `SELECT day, diary, mood, sleep_hours, sleep_bed, sleep_wake, workout, workout_note, updated_at
  FROM days WHERE day = $1`;

export async function readDay(run: Run, day: string): Promise<Day | null> {
  const loaded = await run([{ sql: DAY_SQL, values: [day] }]);
  const row = loaded.batches[0]?.rows[0];
  return row ? daySchema.parse(row) : null;
}

export function loadDay(day: string): Promise<Day | null> {
  return withLock((run) => readDay(run, day));
}

export async function saveDay(day: Day, force = false): Promise<DaySave> {
  try {
    return await withStamp((stamp, run) => saveDayOn(run, day, stamp, force));
  } catch {
    try {
      const current = await loadDay(day.day);
      if (current) return { status: "conflict", current };
    } catch {
      // The read failed the same way as the write.
    }
    return { status: "error", message: "Not saved" };
  }
}

/** One stamp for the day row. `updatedAt` of `""` inserts. A stale stamp returns the current row. */
export async function saveDayOn(run: Run, day: Day, stamp: string, force = false): Promise<DaySave> {
  const checked = checkedDay(day);
  if ("error" in checked) return { status: "error", message: checked.error };
  const values = dayValues(checked.day, stamp);
  if (!day.updatedAt) {
    await insertDay(run, values);
    return { status: "saved", row: { ...checked.day, updatedAt: stamp } };
  }
  const sql = force
    ? `UPDATE days
       SET diary = $1, mood = $2, sleep_hours = $3, sleep_bed = $4, sleep_wake = $5,
           workout = $6, workout_note = $7, updated_at = $8
       WHERE day = $9`
    : `UPDATE days
       SET diary = $1, mood = $2, sleep_hours = $3, sleep_bed = $4, sleep_wake = $5,
           workout = $6, workout_note = $7, updated_at = $8
       WHERE day = $9 AND updated_at = $10`;
  const saved = await run([{ sql, values: force ? values : [...values, day.updatedAt] }]);
  if ((saved.batches[0]?.rowsAffected ?? 0) > 0) {
    return { status: "saved", row: { ...checked.day, updatedAt: stamp } };
  }
  const current = await readDay(run, day.day);
  if (current && !force) return { status: "conflict", current };
  await insertDay(run, values);
  return { status: "saved", row: { ...checked.day, updatedAt: stamp } };
}

function insertDay(run: Run, values: (string | number | null)[]): Promise<unknown> {
  return run([
    {
      sql: `INSERT INTO days (diary, mood, sleep_hours, sleep_bed, sleep_wake, workout, workout_note, updated_at, day)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      values,
    },
  ]);
}

function dayValues(day: Day, stamp: string): (string | number | null)[] {
  return [day.diary, day.mood, day.sleepHours, day.sleepBed, day.sleepWake, day.workout, day.workoutNote, stamp, day.day];
}

function checkedDay(day: Day): { day: Day } | { error: string } {
  if (day.mood !== null && (!Number.isInteger(day.mood) || day.mood < 1 || day.mood > 5)) {
    return { error: "Not saved" };
  }
  if (day.sleepHours !== null && (!Number.isFinite(day.sleepHours) || day.sleepHours < 0 || day.sleepHours > 24)) {
    return { error: "Sleep hours are from 0 to 24." };
  }
  if (day.workout !== null && day.workout !== "yes" && day.workout !== "no") return { error: "Not saved" };
  return { day: { ...day, workoutNote: day.workoutNote.slice(0, 500) } };
}
