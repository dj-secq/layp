import { Temporal } from "temporal-polyfill";
import { firstDueDate, parseRule, rule, serializeRule, type RecurrenceRule, type WeekdayCode } from "./recur";

export type RecurrenceDraft = {
  freq: "none" | RecurrenceRule["freq"];
  interval: string;
  weekdays: WeekdayCode[];
  monthDay: string;
  basis: RecurrenceRule["basis"];
  end: "never" | "on" | "count";
  endDate: string;
  endCount: string;
};

export function draftFromRule(value: RecurrenceRule | null): RecurrenceDraft {
  if (!value) {
    return {
      freq: "none",
      interval: "1",
      weekdays: [],
      monthDay: "",
      basis: "scheduled",
      end: "never",
      endDate: "",
      endCount: "1",
    };
  }
  return {
    freq: value.freq,
    interval: String(value.interval),
    weekdays: value.byWeekday ? [...value.byWeekday] : [],
    monthDay: value.byMonthDay === null ? "" : String(value.byMonthDay),
    basis: value.basis,
    end: value.end.type,
    endDate: value.end.type === "on" ? value.end.date : "",
    endCount: value.end.type === "count" ? String(value.end.remaining) : "1",
  };
}

export function recurrenceDraftError(draft: RecurrenceDraft): string | null {
  if (draft.freq === "none") return null;
  if (integerIn(draft.interval, 1, 99) === null) return "Interval is 1 to 99.";
  if ((draft.freq === "monthly" || draft.freq === "yearly") && draft.monthDay.trim() !== "" && integerIn(draft.monthDay, 1, 31) === null) {
    return "Month day is 1 to 31.";
  }
  if (draft.end === "on" && civilDate(draft.endDate) === null) return "Add an end date.";
  if (draft.end === "count" && integerIn(draft.endCount, 1, 999) === null) return "Count is 1 to 999.";
  return null;
}

/** Fields to pass to patchTask. dueOn is set only when the task has none and the draft repeats. */
export function recurrenceSave(
  draft: RecurrenceDraft,
  task: { dueOn: string | null; dueTime: string | null },
  today: string,
  nowMinutes: number | null,
): { recurrence: RecurrenceRule | null; dueOn?: string } {
  const message = recurrenceDraftError(draft);
  if (message) throw new Error(message);
  if (draft.freq === "none") return { recurrence: null };
  const recurrence = canonicalRule(draft);
  if (task.dueOn !== null) return { recurrence };
  return { recurrence, dueOn: firstDueDate(recurrence, today, task.dueTime, nowMinutes) };
}

function canonicalRule(draft: RecurrenceDraft): RecurrenceRule {
  if (draft.freq === "none") throw new Error("Not saved");
  const interval = integerIn(draft.interval, 1, 99) ?? 1;
  const monthDay = draft.freq === "monthly" || draft.freq === "yearly" ? integerIn(draft.monthDay, 1, 31) : null;
  const weekdays = uniqueWeekdays(draft.weekdays);
  const end =
    draft.end === "on"
      ? { type: "on" as const, date: civilDate(draft.endDate) ?? draft.endDate }
      : draft.end === "count"
        ? { type: "count" as const, remaining: integerIn(draft.endCount, 1, 999) ?? 1 }
        : { type: "never" as const };
  const built = rule({
    freq: draft.freq,
    interval,
    byWeekday: draft.freq === "weekly" && weekdays.length > 0 ? weekdays : null,
    byMonthDay: monthDay,
    basis: draft.basis,
    end,
  });
  const checked = parseRule(serializeRule(built));
  if (!checked) throw new Error("Not saved");
  return checked;
}

function uniqueWeekdays(days: WeekdayCode[]): WeekdayCode[] {
  const seen = new Set<WeekdayCode>();
  const result: WeekdayCode[] = [];
  for (const day of days) {
    if (seen.has(day)) continue;
    seen.add(day);
    result.push(day);
  }
  return result;
}

function integerIn(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value < min || value > max) return null;
  return value;
}

function civilDate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return Temporal.PlainDate.from(trimmed).toString();
  } catch {
    return null;
  }
}
