import { query } from "./client";

export async function sleepAndWorkouts(from: string, to: string): Promise<Array<{ day: string; sleepHours: number | null; workout: string | null }>> {
  const rows = await query<{ day: string; sleep_hours: number | null; workout: string | null }>(
    `SELECT day, sleep_hours, workout FROM days WHERE day >= $1 AND day <= $2`,
    [from, to],
  );
  return rows.map((row) => ({
    day: row.day,
    sleepHours: row.sleep_hours === null || row.sleep_hours === undefined ? null : Number(row.sleep_hours),
    workout: row.workout,
  }));
}
