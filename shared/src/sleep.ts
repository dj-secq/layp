import { addDays } from "./dates";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes added when the tap is "in 5 minutes", so the logged time is closer to falling asleep. */
export const SLEEP_LAG_MINUTES = 5;

/**
 * A tap at this hour or later is stored on the next civil day, the morning you wake into.
 * That leaves today's finished night in place.
 */
export const SLEEP_EVENING_HOUR = 18;

export type SleepTimes = {
  day: string;
  sleepBed: string | null;
  sleepWake: string | null;
  sleepHours: number | null;
};

export type SleepPatch = {
  sleepBed?: string | null;
  sleepWake?: string | null;
  sleepHours?: number | null;
};

/** Local calendar day `YYYY-MM-DD`. */
export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Local `HH:MM`, shifted by `addMinutes`. */
export function hhmmAt(now: Date, addMinutes = 0): string {
  const at = new Date(now.getTime() + addMinutes * 60_000);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** Tomorrow, today, then yesterday. An open night is the first of these with a bed and no wake. */
export function sleepCandidateDays(now: Date): [string, string, string] {
  const today = localDay(now);
  return [addDays(today, 1), today, addDays(today, -1)];
}

export function openSleep(now: Date, rows: SleepTimes[]): SleepTimes | null {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  for (const day of sleepCandidateDays(now)) {
    const row = byDay.get(day);
    if (row?.sleepBed && !row.sleepWake) return row;
  }
  return null;
}

export type SleepPrompt = "bed" | "wake" | "quiet";

/**
 * The quick bedtime row. An open night stays until it is closed.
 * Evening buttons show only on real today. Any other date stays quiet.
 */
export function sleepPrompt(now: Date, rows: SleepTimes[], viewedDay: string): SleepPrompt {
  if (viewedDay !== localDay(now)) return "quiet";
  if (openSleep(now, rows)) return "wake";
  if (now.getHours() >= SLEEP_EVENING_HOUR) return "bed";
  return "quiet";
}

/**
 * Database row wins. A form value fills a field the database does not have yet,
 * so a bedtime that is still saving is not dropped.
 */
export function combineSleep(db: SleepTimes[], form: SleepTimes | null): SleepTimes[] {
  const days = new Set<string>([...db.map((row) => row.day), ...(form ? [form.day] : [])]);
  const out: SleepTimes[] = [];
  for (const day of days) {
    const row = db.find((item) => item.day === day);
    const local = form?.day === day ? form : null;
    if (!row && local) {
      out.push(local);
      continue;
    }
    if (!row) continue;
    out.push({
      day,
      sleepBed: row.sleepBed ?? local?.sleepBed ?? null,
      sleepWake: row.sleepWake ?? local?.sleepWake ?? null,
      sleepHours: row.sleepHours ?? local?.sleepHours ?? null,
    });
  }
  return out;
}

export type BedPlan =
  | { kind: "bed"; day: string; time: string }
  | { kind: "busy"; day: string };

/** Where a going-to-sleep tap is written. An open night is updated in place. */
export function planBed(now: Date, rows: SleepTimes[], addMinutes = 0): BedPlan {
  const time = hhmmAt(now, addMinutes);
  const open = openSleep(now, rows);
  if (open) return { kind: "bed", day: open.day, time };
  const today = localDay(now);
  const day = now.getHours() >= SLEEP_EVENING_HOUR ? addDays(today, 1) : today;
  const row = rows.find((item) => item.day === day);
  if (row?.sleepBed && row.sleepWake) return { kind: "busy", day };
  return { kind: "bed", day, time };
}

export type WakePlan =
  | { kind: "wake"; day: string; time: string; hours: number | null }
  | { kind: "none" };

/** Wake time for the open night. Hours stay as typed, or become the bed-to-wake span. */
export function planWake(now: Date, rows: SleepTimes[]): WakePlan {
  const open = openSleep(now, rows);
  if (!open?.sleepBed) return { kind: "none" };
  const time = hhmmAt(now);
  const hours = open.sleepHours ?? suggestedSleepHours(open.sleepBed, time);
  return { kind: "wake", day: open.day, time, hours };
}

export function sleepNightWhere(now: Date, day: string): "today" | "tomorrow" | "yesterday" {
  const today = localDay(now);
  if (day === addDays(today, 1)) return "tomorrow";
  if (day === addDays(today, -1)) return "yesterday";
  return "today";
}

export function sleepNightLabel(now: Date, day: string, formattedTime: string): string {
  const where = sleepNightWhere(now, day);
  if (where === "today") return `In bed at ${formattedTime}.`;
  return `In bed at ${formattedTime}. Logged on ${where}.`;
}

export function sleepWakeLabel(now: Date, day: string, formattedTime: string, hours: number | null): string {
  const length = hours === null ? "" : ` ${formatHours(hours)} hours.`;
  const where = sleepNightWhere(now, day);
  const place = where === "today" ? "" : ` Logged on ${where}.`;
  return `Awake at ${formattedTime}.${length}${place}`;
}

export function sleepBusyLabel(now: Date, day: string): string {
  const where = sleepNightWhere(now, day);
  if (where === "tomorrow") return "Tomorrow already has a bed time and a wake time.";
  if (where === "yesterday") return "Yesterday already has a bed time and a wake time.";
  return "Today already has a bed time and a wake time.";
}

export function parseMinutes(value: string): number | null {
  const match = TIME.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Elapsed hours from bed to wake, including overnight. Equal times are 0. */
export function suggestedSleepHours(bed: string | null, wake: string | null): number | null {
  if (!bed || !wake) return null;
  const bedMinutes = parseMinutes(bed);
  const wakeMinutes = parseMinutes(wake);
  if (bedMinutes === null || wakeMinutes === null) return null;
  let diff = wakeMinutes - bedMinutes;
  if (diff < 0) diff += 24 * 60;
  const hours = Math.round((diff / 60) * 10) / 10;
  if (hours < 0 || hours > 24) return null;
  return hours;
}

export function formatHours(hours: number): string {
  return (Math.round(hours * 10) / 10).toFixed(1);
}

export function cleanSleep(input: string): { hours: number | null } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { hours: null };
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
    return { error: "Sleep hours are from 0 to 24." };
  }
  return { hours: Math.round(hours * 10) / 10 };
}
