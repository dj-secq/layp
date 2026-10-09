import { logFailure, query, writeStamped } from "./client";
import { daySchema, emptyDay, type Day, type SaveResult } from "./types";

function parseDay(row: unknown): Day {
  return daySchema.parse(row);
}

export async function getDay(day: string): Promise<Day | null> {
  const rows = await query<unknown>(
    `SELECT day, diary, mood, sleep_hours, sleep_bed, sleep_wake, workout, workout_note, updated_at
     FROM days WHERE day = $1`,
    [day],
  );
  return rows[0] ? parseDay(rows[0]) : null;
}

export async function saveDay(day: Day, expectedUpdatedAt: string, force = false): Promise<SaveResult<Day>> {
  const note = day.workoutNote.slice(0, 500);
  try {
    const saved = await writeStamped((stamp) => {
      const values = [day.diary, day.mood, day.sleepHours, day.sleepBed, day.sleepWake, day.workout, note, stamp, day.day];
      if (!expectedUpdatedAt) {
        return [
          {
            sql: `INSERT INTO days (diary, mood, sleep_hours, sleep_bed, sleep_wake, workout, workout_note, updated_at, day)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            values,
          },
        ];
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
      return [{ sql, values: force ? values : [...values, expectedUpdatedAt] }];
    });
    if (!expectedUpdatedAt) {
      return { status: "saved", row: { ...day, workoutNote: note, updatedAt: saved.stamp } };
    }
    if ((saved.batches[0]?.rowsAffected ?? 0) === 0) {
      const current = await getDay(day.day);
      if (!current) return saveDay(day, "", false);
      return { status: "conflict", current };
    }
    return { status: "saved", row: { ...day, workoutNote: note, updatedAt: saved.stamp } };
  } catch {
    if (!expectedUpdatedAt) {
      const current = await getDay(day.day);
      if (current) return { status: "conflict", current };
    }
    await logFailure("day save failed");
    return { status: "error", message: "Not saved" };
  }
}

export { emptyDay };
