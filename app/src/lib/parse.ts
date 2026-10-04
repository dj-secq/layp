import { Temporal } from "temporal-polyfill";
import {
  comingWeekday,
  firstDueDate,
  nextWeekdayAfter,
  rule,
  weekdayCode,
  type RecurrenceRule,
  type WeekdayCode,
} from "./recur";

export type QuickList = { id: string; name: string };

export type QuickParse =
  | { status: "empty" }
  | { status: "reject" }
  | {
      status: "ok";
      title: string;
      listId: string | null;
      priority: "none" | "low" | "medium" | "high";
      important: boolean;
      dueOn: string | null;
      dueTime: string | null;
      recurrence: RecurrenceRule | null;
      notice: string | null;
    };

type Now = { today: string; minutes: number | null };

const WEEKDAYS: Record<string, number> = {
  sunday: 7,
  sun: 7,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const WEEKDAY_PATTERN = Object.keys(WEEKDAYS).join("|");
const MONTH_PATTERN = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

export function parseQuickAdd(input: string, lists: QuickList[], now: Now): QuickParse {
  let text = input.trim().replace(/\s+/g, " ");
  if (!text) return { status: "empty" };

  let notice: string | null = null;
  let listId: string | null = null;
  const listMatch = /^(.*)\s+in\s+(.+)$/i.exec(text);
  if (listMatch) {
    const name = listMatch[2].trim();
    const matches = lists.filter((item) => item.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) {
      listId = matches[0].id;
      text = listMatch[1].trim();
    } else if (matches.length === 0) {
      notice = `No list named ${name}.`;
    }
  }

  let priority: "none" | "low" | "medium" | "high" = "none";
  let important = false;
  const priorityMatch = /(^|\s)(!!!|!!|!|p1|p2|p3)(?=\s|$)/i.exec(text);
  if (priorityMatch) {
    const token = priorityMatch[2].toLowerCase();
    if (token === "p1" || token === "!!!" || token === "!") priority = "high";
    else if (token === "p2" || token === "!!") priority = "medium";
    else priority = "low";
    important = token === "p1";
    text = cut(text, priorityMatch.index, priorityMatch[0].length);
  }

  const recurrence = takeRecurrence(text);
  if (recurrence) text = recurrence.rest;

  const time = takeTime(text);
  if (time) text = time.rest;

  const date = takeDate(text, now, time?.value ?? null);
  if (date) text = date.rest;

  let dueOn = date?.dueOn ?? null;
  let dueTime = time?.value ?? null;
  if (date?.tonight && !dueTime) dueTime = "21:00";
  if (recurrence && !dueOn) {
    dueOn = firstDueDate(recurrence.rule, now.today, dueTime, now.minutes);
  }

  const title = text.trim();
  if (!title) return { status: "reject" };
  return {
    status: "ok",
    title,
    listId,
    priority,
    important,
    dueOn,
    dueTime,
    recurrence: recurrence?.rule ?? null,
    notice,
  };
}

function takeRecurrence(text: string): { rule: RecurrenceRule; rest: string } | null {
  const patterns: Array<{ re: RegExp; build: (match: RegExpExecArray) => RecurrenceRule | null }> = [
    {
      re: /(?:^|\s)every month on the (\d{1,2})(st|nd|rd|th)(?=\s|$)/i,
      build: (match) => {
        const day = Number(match[1]);
        if (!ordinalOk(day, match[2])) return null;
        return rule({ freq: "monthly", byMonthDay: day });
      },
    },
    {
      re: /(?:^|\s)every weekday(?=\s|$)/i,
      build: () => rule({ freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] }),
    },
    {
      re: /(?:^|\s)every day(?=\s|$)/i,
      build: () => rule({ freq: "daily" }),
    },
    {
      re: new RegExp(`(?:^|\\s)every (${WEEKDAY_PATTERN})(?=\\s|$)`, "i"),
      build: (match) => rule({ freq: "weekly", byWeekday: [codeFor(match[1])] }),
    },
    {
      re: /(?:^|\s)every week(?!day)(?=\s|$)/i,
      build: () => rule({ freq: "weekly" }),
    },
    {
      re: /(?:^|\s)every month(?=\s|$)/i,
      build: () => rule({ freq: "monthly" }),
    },
  ];
  const found = earliest(text, patterns.map((item) => item.re));
  if (!found) return null;
  const built = patterns[found.pattern].build(found.match);
  if (!built) return null;
  return { rule: built, rest: cut(text, found.match.index, found.match[0].length) };
}

function takeTime(text: string): { value: string; rest: string } | null {
  const clock12 = /(?:^|\s)(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?(?=\s|$)/i.exec(text);
  const clock24 = /(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)/.exec(text);
  const picks = [clock12, clock24].filter((match): match is RegExpExecArray => match !== null);
  if (picks.length === 0) return null;
  picks.sort((a, b) => a.index - b.index || b[0].length - a[0].length);
  const match = picks[0];
  if (match === clock12 && clock12) {
    let hour = Number(clock12[1]);
    if (hour < 1 || hour > 12) return null;
    const pm = clock12[3].toLowerCase() === "p";
    if (!pm) hour = hour === 12 ? 0 : hour;
    else if (hour !== 12) hour += 12;
    const minute = clock12[2] ?? "00";
    return { value: `${pad(hour)}:${minute}`, rest: cut(text, clock12.index, clock12[0].length) };
  }
  return {
    value: `${pad(Number(match[1]))}:${match[2]}`,
    rest: cut(text, match.index, match[0].length),
  };
}

function takeDate(
  text: string,
  now: Now,
  dueTime: string | null,
): { dueOn: string; tonight: boolean; rest: string } | null {
  const patterns: Array<{ re: RegExp; build: (match: RegExpExecArray) => { dueOn: string; tonight: boolean } | null }> = [
    {
      re: /(?:^|\s)tonight(?=\s|$)/i,
      build: () => ({ dueOn: now.today, tonight: true }),
    },
    {
      re: /(?:^|\s)today(?=\s|$)/i,
      build: () => ({ dueOn: now.today, tonight: false }),
    },
    {
      re: /(?:^|\s)tomorrow(?=\s|$)/i,
      build: () => ({ dueOn: Temporal.PlainDate.from(now.today).add({ days: 1 }).toString(), tonight: false }),
    },
    {
      re: new RegExp(`(?:^|\\s)next (${WEEKDAY_PATTERN})(?=\\s|$)`, "i"),
      build: (match) => ({ dueOn: nextWeekdayAfter(now.today, WEEKDAYS[match[1].toLowerCase()]), tonight: false }),
    },
    {
      re: new RegExp(`(?:^|\\s)(${WEEKDAY_PATTERN})(?=\\s|$)`, "i"),
      build: (match) => ({
        dueOn: comingWeekday(now.today, WEEKDAYS[match[1].toLowerCase()], dueTime, now.minutes),
        tonight: false,
      }),
    },
    {
      re: /(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?=\s|$)/,
      build: (match) => {
        const iso = civil(Number(match[1]), Number(match[2]), Number(match[3]));
        return iso ? { dueOn: iso, tonight: false } : null;
      },
    },
    {
      re: new RegExp(`(?:^|\\s)(${MONTH_PATTERN})\\s+(\\d{1,2})(?=\\s|$)`, "i"),
      build: (match) => {
        const month = MONTHS[match[1].toLowerCase()];
        const day = Number(match[2]);
        const today = Temporal.PlainDate.from(now.today);
        const thisYear = civil(today.year, month, day);
        if (thisYear && thisYear >= now.today) return { dueOn: thisYear, tonight: false };
        const nextYear = civil(today.year + 1, month, day);
        return nextYear ? { dueOn: nextYear, tonight: false } : null;
      },
    },
  ];
  const found = earliest(
    text,
    patterns.map((item) => item.re),
  );
  if (!found) return null;
  const built = patterns[found.pattern].build(found.match);
  if (!built) return null;
  return { ...built, rest: cut(text, found.match.index, found.match[0].length) };
}

function earliest(text: string, patterns: RegExp[]): { pattern: number; match: RegExpExecArray } | null {
  let best: { pattern: number; match: RegExpExecArray } | null = null;
  patterns.forEach((pattern, index) => {
    const match = pattern.exec(text);
    if (!match) return;
    if (!best || match.index < best.match.index || (match.index === best.match.index && match[0].length > best.match[0].length)) {
      best = { pattern: index, match };
    }
  });
  return best;
}

function cut(text: string, index: number, length: number): string {
  return `${text.slice(0, index)} ${text.slice(index + length)}`.replace(/\s+/g, " ").trim();
}

function codeFor(name: string): WeekdayCode {
  return weekdayCode(WEEKDAYS[name.toLowerCase()]);
}

function ordinalOk(day: number, suffix: string): boolean {
  if (day < 1 || day > 31) return false;
  const mod = day % 10;
  const teen = day % 100;
  const expected = teen >= 11 && teen <= 13 ? "th" : mod === 1 ? "st" : mod === 2 ? "nd" : mod === 3 ? "rd" : "th";
  return suffix.toLowerCase() === expected;
}

function civil(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  try {
    const date = Temporal.PlainDate.from({ year, month, day });
    return date.day === day ? date.toString() : null;
  } catch {
    return null;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
