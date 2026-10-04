import { Temporal } from "temporal-polyfill";
import { addDays } from "./dates";
import { dayObligation, isSuccess, type LogMark, type Schedule, type TrackerKind } from "./journal";

export function daysEnding(today: string, count: number): string[] {
  const total = Math.max(1, Math.floor(count));
  const start = addDays(today, -(total - 1));
  const days: string[] = [];
  let cursor = Temporal.PlainDate.from(start);
  const last = Temporal.PlainDate.from(today);
  while (Temporal.PlainDate.compare(cursor, last) <= 0) {
    days.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }
  return days;
}

/** `count` civil days with today near the middle, so later days sit to the right. */
export function daysAround(today: string, count: number): string[] {
  const total = Math.max(1, Math.floor(count));
  const before = Math.floor((total - 1) / 2);
  const days: string[] = [];
  let cursor = Temporal.PlainDate.from(addDays(today, -before));
  for (let index = 0; index < total; index += 1) {
    days.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }
  return days;
}

export function civilDay(instant: string, timeZone: string): string | null {
  try {
    return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString();
  } catch {
    return null;
  }
}

export function countsByDay(days: string[], events: Array<string | null>): number[] {
  const counts = new Map(days.map((day) => [day, 0]));
  for (const event of events) {
    if (event && counts.has(event)) counts.set(event, (counts.get(event) ?? 0) + 1);
  }
  return days.map((day) => counts.get(day) ?? 0);
}

export function sumByDay(days: string[], events: Array<{ day: string | null; amount: number }>): number[] {
  const totals = new Map(days.map((day) => [day, 0]));
  for (const event of events) {
    if (!event.day || !totals.has(event.day) || !Number.isFinite(event.amount)) continue;
    totals.set(event.day, (totals.get(event.day) ?? 0) + event.amount);
  }
  return days.map((day) => totals.get(day) ?? 0);
}

/** Scheduled days met, excluding today and skipped days. Weekly-count trackers have no daily obligation. */
export function trackerRate(input: {
  kind: TrackerKind;
  dailyTarget: number | null;
  schedule: Schedule;
  logs: LogMark[];
  start: string;
  today: string;
}): { met: number; scheduled: number } {
  const logs = new Map(input.logs.map((log) => [log.day, log]));
  let met = 0;
  let scheduled = 0;
  let cursor = Temporal.PlainDate.from(input.start);
  const last = Temporal.PlainDate.from(input.today).subtract({ days: 1 });
  if (Temporal.PlainDate.compare(cursor, last) > 0) return { met: 0, scheduled: 0 };
  while (Temporal.PlainDate.compare(cursor, last) <= 0) {
    const day = cursor.toString();
    const log = logs.get(day) ?? null;
    if (dayObligation(input.schedule, day) && log?.state !== "skipped") {
      scheduled += 1;
      if (isSuccess(input.kind, input.dailyTarget, log)) met += 1;
    }
    cursor = cursor.add({ days: 1 });
  }
  return { met, scheduled };
}

export type DayReading = "down" | "productive" | "quiet";

/**
 * Mood 1 or 2 is a down day even when other work happened.
 * A productive day has two marks. A second task, hobby, or tracker counts as another mark.
 * Anything lighter, including a high mood on its own, stays quiet.
 */
export function dayReading(input: {
  mood: number | null;
  tasks: number;
  focus: number;
  workout: boolean;
  hobbyHits: number;
  trackerHits: number;
}): DayReading {
  if (input.mood === 1 || input.mood === 2) return "down";
  let marks = 0;
  if (input.tasks > 0) marks += 1;
  if (input.tasks > 1) marks += 1;
  if (input.focus > 0) marks += 1;
  if (input.workout) marks += 1;
  if (input.hobbyHits > 0) marks += 1;
  if (input.hobbyHits > 1) marks += 1;
  if (input.trackerHits > 0) marks += 1;
  if (input.trackerHits > 1) marks += 1;
  if (input.mood === 4 || input.mood === 5) marks += 1;
  return marks >= 2 ? "productive" : "quiet";
}

export type TrackerTone = "fill" | "skip" | "miss" | "empty";

/** A past scheduled day that was not done and not skipped. Today stays open, and a weekly count has no daily miss. */
export function trackerTone(input: {
  kind: TrackerKind;
  dailyTarget: number | null;
  schedule: Schedule;
  log: LogMark | null;
  day: string;
  today: string;
}): TrackerTone {
  if (input.log?.state === "skipped") return "skip";
  if (isSuccess(input.kind, input.dailyTarget, input.log)) return "fill";
  if (input.day < input.today && dayObligation(input.schedule, input.day)) return "miss";
  return "empty";
}
