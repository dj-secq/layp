import { Temporal } from "temporal-polyfill";

export type WeekdayCode = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type RecurrenceEnd =
  | { type: "never" }
  | { type: "on"; date: string }
  | { type: "count"; remaining: number };

export type RecurrenceRule = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  byWeekday: WeekdayCode[] | null;
  byMonthDay: number | null;
  basis: "scheduled" | "completed";
  end: RecurrenceEnd;
};

const CODES: WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function weekdayCode(dayOfWeek: number): WeekdayCode {
  return CODES[dayOfWeek - 1] ?? "MO";
}

export function dayOfWeekCode(code: WeekdayCode): number {
  return CODES.indexOf(code) + 1;
}

export function rule(partial: Partial<RecurrenceRule> & Pick<RecurrenceRule, "freq">): RecurrenceRule {
  return {
    freq: partial.freq,
    interval: partial.interval ?? 1,
    byWeekday: partial.byWeekday ?? null,
    byMonthDay: partial.byMonthDay ?? null,
    basis: partial.basis ?? "scheduled",
    end: partial.end ?? { type: "never" },
  };
}

export function serializeRule(value: RecurrenceRule): string {
  return JSON.stringify({
    freq: value.freq,
    interval: value.interval,
    byWeekday: value.byWeekday,
    byMonthDay: value.byMonthDay,
    basis: value.basis,
    end: value.end,
  });
}

export function parseRule(json: string): RecurrenceRule | null {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const freq = row.freq;
    if (freq !== "daily" && freq !== "weekly" && freq !== "monthly" && freq !== "yearly") return null;
    const interval = row.interval;
    if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > 99) return null;
    const byWeekday = parseWeekdays(row.byWeekday);
    if (byWeekday === undefined) return null;
    const byMonthDay = row.byMonthDay;
    if (byMonthDay !== null && (typeof byMonthDay !== "number" || !Number.isInteger(byMonthDay) || byMonthDay < 1 || byMonthDay > 31)) {
      return null;
    }
    const basis = row.basis;
    if (basis !== "scheduled" && basis !== "completed") return null;
    const end = parseEnd(row.end);
    if (!end) return null;
    return { freq, interval, byWeekday, byMonthDay: byMonthDay === null ? null : byMonthDay, basis, end };
  } catch {
    return null;
  }
}

function parseWeekdays(value: unknown): WeekdayCode[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const days: WeekdayCode[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !CODES.includes(item as WeekdayCode)) return undefined;
    const code = item as WeekdayCode;
    if (!days.includes(code)) days.push(code);
  }
  return days;
}

function parseEnd(value: unknown): RecurrenceEnd | null {
  if (!value || typeof value !== "object") return null;
  const end = value as Record<string, unknown>;
  if (end.type === "never") return { type: "never" };
  if (end.type === "on" && typeof end.date === "string") {
    try {
      return { type: "on", date: Temporal.PlainDate.from(end.date).toString() };
    } catch {
      return null;
    }
  }
  if (end.type === "count" && typeof end.remaining === "number" && Number.isInteger(end.remaining) && end.remaining >= 1) {
    return { type: "count", remaining: end.remaining };
  }
  return null;
}

/** The date the next occurrence is counted from. */
export function anchorDate(value: RecurrenceRule, dueOn: string | null, completedOn: string): string | null {
  if (value.basis === "completed") return completedOn;
  return dueOn;
}

/**
 * The next due date after `anchorOn`. Returns null when the end date or the
 * remaining count cannot produce another occurrence.
 */
export function nextDueDate(value: RecurrenceRule, anchorOn: string): string | null {
  if (value.end.type === "count" && value.end.remaining <= 1) return null;
  const anchor = Temporal.PlainDate.from(anchorOn);
  const interval = value.interval;
  let next: Temporal.PlainDate;
  if (value.freq === "daily") {
    next = value.byWeekday?.length ? nthWeekday(anchor, value.byWeekday, interval) : anchor.add({ days: interval });
  } else if (value.freq === "weekly") {
    next = nextWeekly(anchor, value.byWeekday, interval);
  } else if (value.freq === "monthly") {
    next = nextMonthLike(anchor, value.byMonthDay ?? anchor.day, interval, "month");
  } else {
    next = nextMonthLike(anchor, value.byMonthDay ?? anchor.day, interval, "year");
  }
  const iso = next.toString();
  if (value.end.type === "on" && iso > value.end.date) return null;
  return iso;
}

/** Rule stored on the occurrence created by completing the current one. */
export function ruleAfterComplete(value: RecurrenceRule): RecurrenceRule | null {
  if (value.end.type === "count") {
    if (value.end.remaining <= 1) return null;
    return { ...value, end: { type: "count", remaining: value.end.remaining - 1 } };
  }
  return value;
}

/** First due date on or after today. A time that has already passed moves to the following occurrence. */
export function firstDueDate(value: RecurrenceRule, today: string, dueTime: string | null, nowMinutes: number | null): string {
  const open = value.end.type === "count" ? { ...value, end: { type: "never" as const } } : value;
  let candidate = firstOnOrAfter(open, Temporal.PlainDate.from(today));
  if (dueTime && candidate.toString() === today && timeHasPassed(dueTime, nowMinutes)) {
    const following = nextDueDate({ ...open, end: { type: "never" } }, candidate.toString());
    if (following) candidate = Temporal.PlainDate.from(following);
  }
  return candidate.toString();
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function describeRule(value: RecurrenceRule): string {
  const every = value.interval === 1 ? "Every" : `Every ${value.interval}`;
  if (value.freq === "daily") return value.interval === 1 ? "Every day" : `${every} days`;
  if (value.freq === "weekly") {
    const days = value.byWeekday ?? [];
    const weekdays = ["MO", "TU", "WE", "TH", "FR"];
    if (days.length === 5 && weekdays.every((day) => days.includes(day as WeekdayCode))) {
      return value.interval === 1 ? "Every weekday" : `${every} weeks on weekdays`;
    }
    if (days.length === 1) {
      const name = WEEKDAY_NAMES[dayOfWeekCode(days[0]) - 1];
      return value.interval === 1 ? `Every ${name}` : `${every} weeks on ${name}`;
    }
    if (days.length > 1) {
      const names = days.map((day) => WEEKDAY_NAMES[dayOfWeekCode(day) - 1]).join(", ");
      return value.interval === 1 ? `Every ${names}` : `${every} weeks on ${names}`;
    }
    return value.interval === 1 ? "Every week" : `${every} weeks`;
  }
  if (value.freq === "monthly") {
    if (value.byMonthDay) return value.interval === 1 ? `Every month on the ${ordinal(value.byMonthDay)}` : `${every} months on the ${ordinal(value.byMonthDay)}`;
    return value.interval === 1 ? "Every month" : `${every} months`;
  }
  return value.interval === 1 ? "Every year" : `${every} years`;
}

function ordinal(day: number): string {
  const mod = day % 10;
  const teen = day % 100;
  const suffix = teen >= 11 && teen <= 13 ? "th" : mod === 1 ? "st" : mod === 2 ? "nd" : mod === 3 ? "rd" : "th";
  return `${day}${suffix}`;
}

export function comingWeekday(today: string, dayOfWeek: number, dueTime: string | null, nowMinutes: number | null): string {
  const date = Temporal.PlainDate.from(today);
  let delta = (dayOfWeek - date.dayOfWeek + 7) % 7;
  if (delta === 0 && dueTime && timeHasPassed(dueTime, nowMinutes)) delta = 7;
  return date.add({ days: delta }).toString();
}

export function nextWeekdayAfter(today: string, dayOfWeek: number): string {
  const date = Temporal.PlainDate.from(today);
  let delta = (dayOfWeek - date.dayOfWeek + 7) % 7;
  if (delta === 0) delta = 7;
  return date.add({ days: delta }).toString();
}

function timeHasPassed(dueTime: string, nowMinutes: number | null): boolean {
  if (nowMinutes === null) return false;
  const [hour, minute] = dueTime.split(":").map(Number);
  return nowMinutes > hour * 60 + minute;
}

function firstOnOrAfter(value: RecurrenceRule, today: Temporal.PlainDate): Temporal.PlainDate {
  if ((value.freq === "daily" || value.freq === "weekly") && value.byWeekday?.length) {
    const wanted = new Set(value.byWeekday.map(dayOfWeekCode));
    if (wanted.has(today.dayOfWeek)) return today;
    return Temporal.PlainDate.from(nthWeekday(today, value.byWeekday, 1).toString());
  }
  if (value.freq === "monthly") {
    const day = value.byMonthDay ?? today.day;
    const thisMonth = clampDay(today.year, today.month, day);
    if (Temporal.PlainDate.compare(thisMonth, today) >= 0) return thisMonth;
    return nextMonthLike(today, day, 1, "month");
  }
  return today;
}

function nthWeekday(anchor: Temporal.PlainDate, codes: WeekdayCode[], count: number): Temporal.PlainDate {
  const wanted = new Set(codes.map(dayOfWeekCode));
  let cursor = anchor;
  let seen = 0;
  for (let step = 0; step < 4000; step += 1) {
    cursor = cursor.add({ days: 1 });
    if (!wanted.has(cursor.dayOfWeek)) continue;
    seen += 1;
    if (seen === count) return cursor;
  }
  return anchor.add({ days: count });
}

function nextWeekly(anchor: Temporal.PlainDate, codes: WeekdayCode[] | null, interval: number): Temporal.PlainDate {
  if (!codes?.length) return anchor.add({ weeks: interval });
  const days = [...new Set(codes.map(dayOfWeekCode))].sort((a, b) => a - b);
  const later = days.find((day) => day > anchor.dayOfWeek);
  if (later) return anchor.add({ days: later - anchor.dayOfWeek });
  const toNextMonday = 8 - anchor.dayOfWeek;
  const first = days[0] ?? 1;
  return anchor.add({ days: toNextMonday + (interval - 1) * 7 + (first - 1) });
}

function nextMonthLike(
  anchor: Temporal.PlainDate,
  monthDay: number,
  interval: number,
  unit: "month" | "year",
): Temporal.PlainDate {
  if (unit === "year") return clampDay(anchor.year + interval, anchor.month, monthDay);
  const shifted = Temporal.PlainDate.from({ year: anchor.year, month: anchor.month, day: 1 }).add({ months: interval });
  return clampDay(shifted.year, shifted.month, monthDay);
}

function clampDay(year: number, month: number, day: number): Temporal.PlainDate {
  const first = Temporal.PlainDate.from({ year, month, day: 1 });
  return first.with({ day: Math.min(day, first.daysInMonth) });
}
