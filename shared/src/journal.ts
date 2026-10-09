import { Temporal } from "temporal-polyfill";
import type { WeekStart } from "./dates";

export type TrackerKind = "check" | "count" | "number" | "scale" | "minutes";

export type Schedule =
  | { type: "daily" }
  | { type: "weekdays"; days: number[] }
  | { type: "weekly_count"; count: number };

export type LogMark = {
  day: string;
  state: "done" | "skipped";
  value: number | null;
};

const maxStreakDays = 4000;
const maxStreakWeeks = 520;

function uniqueWeekdays(days: readonly number[]): number[] {
  return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort(
    (left, right) => left - right,
  );
}

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseSchedule(json: string): Schedule {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { type: "daily" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { type: "daily" };
  const record = value as { type?: unknown; days?: unknown; count?: unknown };
  if (record.type === "daily") return { type: "daily" };
  if (record.type === "weekdays" && Array.isArray(record.days)) {
    const days = uniqueWeekdays(record.days.filter((day): day is number => typeof day === "number"));
    if (days.length === 0) return { type: "daily" };
    return { type: "weekdays", days };
  }
  if (
    record.type === "weekly_count" &&
    typeof record.count === "number" &&
    Number.isInteger(record.count) &&
    record.count >= 1 &&
    record.count <= 7
  ) {
    return { type: "weekly_count", count: record.count };
  }
  return { type: "daily" };
}

export function serializeSchedule(schedule: Schedule): string {
  if (schedule.type === "weekdays") {
    const days = [...new Set(schedule.days)].sort((left, right) => left - right);
    return JSON.stringify({ type: "weekdays", days });
  }
  if (schedule.type === "weekly_count") {
    return JSON.stringify({ type: "weekly_count", count: schedule.count });
  }
  return JSON.stringify({ type: "daily" });
}

export function cellScheduled(schedule: Schedule, iso: string): boolean {
  if (schedule.type === "daily" || schedule.type === "weekly_count") return true;
  return schedule.days.includes(Temporal.PlainDate.from(iso).dayOfWeek);
}

export function dayObligation(schedule: Schedule, iso: string): boolean {
  if (schedule.type === "weekly_count") return false;
  return cellScheduled(schedule, iso);
}

export function isSuccess(kind: TrackerKind, dailyTarget: number | null, log: LogMark | null): boolean {
  if (!log || log.state !== "done") return false;
  if (kind === "check") return true;
  const value = log.value;
  const finite = typeof value === "number" && Number.isFinite(value);
  if (kind === "count") return finite && value >= (dailyTarget ?? 1);
  if (kind === "number") return finite && (dailyTarget === null || value >= dailyTarget);
  if (kind === "scale") return finite;
  return finite && value > 0 && (dailyTarget === null || value >= dailyTarget);
}

export type StreakResult = {
  streak: number;
  label: string;
  todayIsMiss: boolean;
};

function indexLogs(logs: LogMark[]): Map<string, LogMark> {
  const indexed = new Map<string, LogMark>();
  for (const log of logs) indexed.set(log.day, log);
  return indexed;
}

function successesBetween(
  logs: Map<string, LogMark>,
  start: string,
  end: string,
  kind: TrackerKind,
  dailyTarget: number | null,
): number {
  let count = 0;
  let day = Temporal.PlainDate.from(start);
  const last = Temporal.PlainDate.from(end);
  while (Temporal.PlainDate.compare(day, last) <= 0) {
    if (isSuccess(kind, dailyTarget, logs.get(day.toString()) ?? null)) count += 1;
    day = day.add({ days: 1 });
  }
  return count;
}

export function streak(input: {
  kind: TrackerKind;
  dailyTarget: number | null;
  schedule: Schedule;
  logs: LogMark[];
  today: string;
  weekStart: WeekStart;
}): StreakResult {
  const logs = indexLogs(input.logs);
  if (input.schedule.type === "weekly_count") {
    const current = weekBounds(input.today, input.weekStart);
    const successesThisWeek = successesBetween(logs, current.start, current.end, input.kind, input.dailyTarget);
    let streakCount = 0;
    let probe = Temporal.PlainDate.from(current.start).subtract({ days: 1 });
    for (let week = 0; week < maxStreakWeeks; week += 1) {
      const bounds = weekBounds(probe.toString(), input.weekStart);
      const successes = successesBetween(logs, bounds.start, bounds.end, input.kind, input.dailyTarget);
      if (successes < input.schedule.count) break;
      streakCount += 1;
      probe = Temporal.PlainDate.from(bounds.start).subtract({ days: 1 });
    }
    return {
      streak: streakCount,
      label: `${successesThisWeek} of ${input.schedule.count}`,
      todayIsMiss: false,
    };
  }

  const today = Temporal.PlainDate.from(input.today);
  const todayLog = logs.get(input.today) ?? null;
  let streakCount = 0;
  let todayIsMiss = false;
  if (dayObligation(input.schedule, input.today)) {
    if (isSuccess(input.kind, input.dailyTarget, todayLog)) streakCount += 1;
    else if (todayLog?.state === "done") todayIsMiss = true;
  }

  for (let offset = 1; offset < maxStreakDays; offset += 1) {
    const iso = today.subtract({ days: offset }).toString();
    if (!dayObligation(input.schedule, iso)) continue;
    const log = logs.get(iso) ?? null;
    if (isSuccess(input.kind, input.dailyTarget, log)) {
      streakCount += 1;
      continue;
    }
    if (log?.state === "skipped") continue;
    break;
  }

  return { streak: streakCount, label: String(streakCount), todayIsMiss };
}

export type HobbySlice = { id: string; color: string; minutes: number };

export function leadingHobby(slices: HobbySlice[]): { color: string; extra: number } | null {
  const positive = slices.filter((slice) => slice.minutes > 0);
  if (positive.length === 0) return null;
  let winner = positive[0];
  for (const slice of positive) {
    if (slice.minutes > winner.minutes || (slice.minutes === winner.minutes && slice.id < winner.id)) {
      winner = slice;
    }
  }
  return { color: winner.color, extra: positive.length - 1 };
}

export function dayShownUp(input: {
  taskCompleted: boolean;
  workoutYes: boolean;
  hobbyMinutes: number;
  trackerDone: boolean;
}): boolean {
  return input.taskCompleted || input.workoutYes || input.hobbyMinutes > 0 || input.trackerDone;
}

export function weekBounds(iso: string, weekStart: WeekStart): { start: string; end: string } {
  const date = Temporal.PlainDate.from(iso);
  const offset = weekStart === "monday" ? date.dayOfWeek - 1 : date.dayOfWeek % 7;
  const start = date.subtract({ days: offset });
  return { start: start.toString(), end: start.add({ days: 6 }).toString() };
}

export function weekBuckets(
  today: string,
  weekStart: WeekStart,
  weeks: number,
): Array<{ start: string; end: string }> {
  const count = Math.max(1, Math.floor(weeks));
  const current = Temporal.PlainDate.from(weekBounds(today, weekStart).start);
  const buckets: Array<{ start: string; end: string }> = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = current.subtract({ days: index * 7 });
    buckets.push({ start: start.toString(), end: start.add({ days: 6 }).toString() });
  }
  return buckets;
}

export function sumMinutes(logs: LogMark[], start: string, end: string): number {
  let total = 0;
  for (const log of logs) {
    if (log.state !== "done" || log.day < start || log.day > end) continue;
    if (typeof log.value !== "number" || !Number.isFinite(log.value) || log.value <= 0) continue;
    total += log.value;
  }
  return total;
}

export function averageSleep(hours: Array<number | null>): number | null {
  const values = hours.filter((hour): hour is number => typeof hour === "number" && Number.isFinite(hour));
  if (values.length === 0) return null;
  const average = values.reduce((sum, hour) => sum + hour, 0) / values.length;
  return Math.round(average * 10) / 10;
}

function cleanedSchedule(schedule: Schedule): { ok: true; schedule: Schedule } | { ok: false; error: string } {
  if (schedule.type === "daily") return { ok: true, schedule: { type: "daily" } };
  if (schedule.type === "weekdays") {
    const days = uniqueWeekdays(schedule.days);
    if (days.length === 0) return { ok: false, error: "Pick at least one day." };
    return { ok: true, schedule: { type: "weekdays", days } };
  }
  if (!Number.isInteger(schedule.count) || schedule.count < 1 || schedule.count > 7) {
    return { ok: false, error: "Weekly count is 1 to 7." };
  }
  return { ok: true, schedule: { type: "weekly_count", count: schedule.count } };
}

export function cleanTrackerDraft(input: {
  name: string;
  kind: TrackerKind;
  unit: string;
  target: string;
  schedule: Schedule;
  hobby: boolean;
}):
  | {
      ok: true;
      name: string;
      kind: TrackerKind;
      unit: string | null;
      dailyTarget: number | null;
      schedule: Schedule;
    }
  | { ok: false; error: string } {
  const name = input.name.trim();
  if (name.length < 1) return { ok: false, error: "Add a name." };
  if (name.length > 80) return { ok: false, error: "Names can be 80 characters." };
  if (input.hobby) {
    return {
      ok: true,
      name,
      kind: "minutes",
      unit: null,
      dailyTarget: null,
      schedule: { type: "daily" },
    };
  }

  const schedule = cleanedSchedule(input.schedule);
  if (!schedule.ok) return schedule;

  if (input.kind === "check" || input.kind === "scale") {
    return { ok: true, name, kind: input.kind, unit: null, dailyTarget: null, schedule: schedule.schedule };
  }
  if (input.kind === "count") {
    const target = wholeNumber(input.target);
    if (target === null || target < 1) return { ok: false, error: "Add a target of at least 1." };
    return { ok: true, name, kind: "count", unit: null, dailyTarget: target, schedule: schedule.schedule };
  }
  if (input.kind === "number") {
    const trimmed = input.target.trim();
    let dailyTarget: number | null = null;
    if (trimmed) {
      const target = Number(trimmed);
      if (!Number.isFinite(target) || target < 0) return { ok: false, error: "Target is a number, 0 or more." };
      dailyTarget = target;
    }
    const unit = input.unit.trim();
    if (unit.length > 20) return { ok: false, error: "Units can be 20 characters." };
    return { ok: true, name, kind: "number", unit: unit.length > 0 ? unit : null, dailyTarget, schedule: schedule.schedule };
  }

  const trimmed = input.target.trim();
  let dailyTarget: number | null = null;
  if (trimmed) {
    const target = wholeNumber(input.target);
    if (target === null || target < 1) return { ok: false, error: "Target is whole minutes, at least 1." };
    dailyTarget = target;
  }
  return { ok: true, name, kind: "minutes", unit: null, dailyTarget, schedule: schedule.schedule };
}

export function cleanLog(input: {
  kind: TrackerKind;
  state: "done" | "skipped";
  valueText: string;
  note: string;
}):
  | { ok: true; state: "done" | "skipped"; value: number | null; note: string }
  | { ok: false; error: string } {
  const note = input.note.trim().slice(0, 2000);
  if (input.state === "skipped" || input.kind === "check") {
    return { ok: true, state: input.state, value: null, note };
  }
  if (input.kind === "number") {
    const trimmed = input.valueText.trim();
    const value = Number(trimmed);
    if (!trimmed || !Number.isFinite(value)) return { ok: false, error: "Enter a number." };
    return { ok: true, state: "done", value, note };
  }
  const value = wholeNumber(input.valueText);
  if (input.kind === "count") {
    if (value === null) return { ok: false, error: "Count is a whole number, 0 or more." };
    return { ok: true, state: "done", value, note };
  }
  if (input.kind === "scale") {
    if (value === null || value < 1 || value > 5) return { ok: false, error: "Scale is 1 to 5." };
    return { ok: true, state: "done", value, note };
  }
  if (value === null) return { ok: false, error: "Minutes are a whole number, 0 or more." };
  return { ok: true, state: "done", value, note };
}
