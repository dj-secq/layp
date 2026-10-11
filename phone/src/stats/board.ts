import {
  averageSleep,
  countsByDay,
  dayReading,
  formatHours,
  isSuccess,
  MOOD_COLORS,
  sleepLine,
  sumByDay,
  sumMinutes,
  trackerRate,
  trackerTone,
  type DayReading,
  type TrackerKind,
  type TrackerTone,
} from "@layp/shared";
import type { DaySnap, Tracker, TrackerLog } from "../db/journal";

const TASK_COLOR = "#ffdc58";
const FOCUS_COLOR = "#7dd3fc";
const SLEEP_COLOR = "#93c5fd";
const WORKOUT_COLOR = "#86efac";
const READING_LABEL: Record<DayReading, string> = { down: "Down", productive: "Productive", quiet: "Quiet" };

export type Mark = {
  title: string;
  text: string;
  tone: TrackerTone;
  color: string | null;
  dot: string | null;
};

export type BoardRow = {
  key: string;
  name: string;
  total: string;
  swatch: string | null;
  group: boolean;
  marks: Mark[];
};

export type AxisLabel = { top: string; day: string };

export type Board = {
  days: string[];
  readings: DayReading[];
  rows: BoardRow[];
  tasks: number[];
  focus: number[];
  sleep: Array<number | null>;
  empty: boolean;
};

export function buildBoard(input: {
  today: string;
  days: string[];
  span: number;
  completedDays: string[];
  sessions: Array<{ day: string; minutes: number }>;
  snaps: DaySnap[];
  trackers: Tracker[];
  logs: TrackerLog[];
  muted: string;
}): Board {
  const { today, days, span, snaps, trackers, logs, muted } = input;
  const snapByDay = new Map(snaps.map((snap) => [snap.day, snap]));
  const logsByTracker = new Map<string, Map<string, TrackerLog>>();
  for (const log of logs) {
    let byDay = logsByTracker.get(log.trackerId);
    if (!byDay) {
      byDay = new Map();
      logsByTracker.set(log.trackerId, byDay);
    }
    byDay.set(log.day, log);
  }
  const tasks = countsByDay(days, input.completedDays);
  const focus = sumByDay(
    days,
    input.sessions.map((session) => ({ day: session.day, amount: session.minutes })),
  );
  const hobbyHits = days.map(() => 0);
  const trackerHits = days.map(() => 0);
  for (const tracker of trackers) {
    const byDay = logsByTracker.get(tracker.id);
    for (let index = 0; index < days.length; index += 1) {
      const log = byDay?.get(days[index]) ?? null;
      if (!isSuccess(tracker.kind, tracker.dailyTarget, log)) continue;
      if (tracker.isHobby) hobbyHits[index] += 1;
      else trackerHits[index] += 1;
    }
  }
  const readings = days.map((day, index) => {
    const snap = snapByDay.get(day);
    return dayReading({
      mood: snap?.mood ?? null,
      tasks: tasks[index] ?? 0,
      focus: focus[index] ?? 0,
      workout: snap?.workout === "yes",
      hobbyHits: hobbyHits[index] ?? 0,
      trackerHits: trackerHits[index] ?? 0,
    });
  });
  const phrases = days.map((day, index) => dayPhrase(day, readings[index] ?? "quiet"));
  const moods = days.map((day) => {
    const mood = snapByDay.get(day)?.mood ?? null;
    return mood !== null && mood >= 1 && mood <= 5 ? mood : null;
  });
  const sleepHours = days.map((day) => {
    const hours = snapByDay.get(day)?.sleepHours ?? null;
    return typeof hours === "number" && Number.isFinite(hours) ? hours : null;
  });
  const workoutYes = days.filter((day) => snapByDay.get(day)?.workout === "yes").length;
  const sleepAverage = averageSleep(sleepHours);
  const recordedMoods = moods.filter((mood): mood is number => mood !== null);
  const rows: BoardRow[] = [
    {
      key: "mood",
      name: "Mood",
      total: formatAverage(recordedMoods),
      swatch: null,
      group: false,
      marks: days.map((_day, index) => moodMark(moods[index] ?? null, span, phrases[index] ?? "")),
    },
    {
      key: "sleep",
      name: "Sleep",
      total: sleepAverage === null ? "—" : `${formatHours(sleepAverage)} h`,
      swatch: SLEEP_COLOR,
      group: false,
      marks: days.map((_day, index) => sleepMark(sleepHours[index] ?? null, span, phrases[index] ?? "")),
    },
    {
      key: "workout",
      name: "Workout",
      total: countLabel(workoutYes, "day", "days"),
      swatch: WORKOUT_COLOR,
      group: false,
      marks: days.map((day, index) => workoutMark(snapByDay.get(day)?.workout ?? null, span, phrases[index] ?? "", muted)),
    },
    {
      key: "tasks",
      name: "Tasks",
      total: String(tasks.reduce((sum, count) => sum + count, 0)),
      swatch: TASK_COLOR,
      group: false,
      marks: days.map((_day, index) => countMark("Tasks", tasks[index] ?? 0, "task", "tasks", TASK_COLOR, span, phrases[index] ?? "")),
    },
    {
      key: "focus",
      name: "Focus",
      total: `${focus.reduce((sum, minutes) => sum + minutes, 0)} min`,
      swatch: FOCUS_COLOR,
      group: false,
      marks: days.map((_day, index) => countMark("Focus", focus[index] ?? 0, "min", "min", FOCUS_COLOR, span, phrases[index] ?? "")),
    },
  ];
  const hobbies = trackers.filter((tracker) => tracker.isHobby);
  const plain = trackers.filter((tracker) => !tracker.isHobby);
  hobbies.forEach((tracker, index) => {
    rows.push(trackerRow(tracker, logsByTracker.get(tracker.id), logs, days, phrases, today, span, index === 0, muted));
  });
  plain.forEach((tracker, index) => {
    rows.push(trackerRow(tracker, logsByTracker.get(tracker.id), logs, days, phrases, today, span, index === 0, muted));
  });
  const empty =
    logs.length === 0 &&
    tasks.every((count) => count === 0) &&
    focus.every((minutes) => minutes === 0) &&
    snaps.every((snap) => snap.mood === null && snap.sleepHours === null && snap.workout === null);
  return { days, readings, rows, tasks, focus, sleep: sleepHours, empty };
}

export function chartSeries(
  span: number,
  days: string[],
  tasks: number[],
  focus: number[],
  sleep: Array<number | null>,
): {
  labels: AxisLabel[];
  tasks: number[];
  focus: number[];
  sleep: Array<number | null>;
} {
  const sleepPoints = sleepLine(span, sleep);
  if (span !== 365) return { labels: axisLabels(days), tasks, focus, sleep: sleepPoints };
  const dayGroups = chunk(days, 7);
  return {
    labels: axisLabels(dayGroups.map((group) => group[0] ?? "")),
    tasks: chunk(tasks, 7).map(sumChunk),
    focus: chunk(focus, 7).map(sumChunk),
    sleep: sleepPoints,
  };
}

export function axisLabels(days: string[]): AxisLabel[] {
  let lastMonth = "";
  return days.map((day, index) => {
    const date = civilDate(day);
    if (days.length <= 7) {
      return { top: date.toLocaleDateString(undefined, { weekday: "short" }), day: String(date.getDate()) };
    }
    const month = date.toLocaleDateString(undefined, { month: "short" });
    const top = month === lastMonth && index !== 0 ? "" : month;
    lastMonth = month;
    return { top, day: String(date.getDate()) };
  });
}

export function columnHead(day: string, index: number, span: number): { top: string; day: string } {
  const date = civilDate(day);
  const month = date.toLocaleDateString(undefined, { month: "short" });
  const showMonth = index === 0 || date.getDate() === 1;
  if (span === 7) return { top: date.toLocaleDateString(undefined, { weekday: "short" }), day: String(date.getDate()) };
  if (span === 365) return { top: showMonth ? month : "", day: "" };
  return { top: showMonth ? month : "", day: String(date.getDate()) };
}

function trackerRow(
  tracker: Tracker,
  byDay: Map<string, TrackerLog> | undefined,
  logs: TrackerLog[],
  days: string[],
  phrases: string[],
  today: string,
  span: number,
  group: boolean,
  muted: string,
): BoardRow {
  const ownLogs = logs.filter((log) => log.trackerId === tracker.id);
  const past = trackerRate({
    kind: tracker.kind,
    dailyTarget: tracker.dailyTarget,
    schedule: tracker.schedule,
    logs: ownLogs,
    start: days[0] ?? today,
    today,
  });
  const todayMet = isSuccess(tracker.kind, tracker.dailyTarget, byDay?.get(today) ?? null);
  const total = tracker.isHobby
    ? `${sumMinutes(ownLogs, days[0] ?? today, days[days.length - 1] ?? today)} min`
    : rateLabel({ met: past.met + (todayMet ? 1 : 0), scheduled: past.scheduled + (todayMet ? 1 : 0) });
  return {
    key: tracker.id,
    name: tracker.name,
    total,
    swatch: tracker.color,
    group,
    marks: days.map((day, index) => trackerMark(tracker, byDay?.get(day) ?? null, day, today, span, phrases[index] ?? "", muted)),
  };
}

function moodMark(mood: number | null, span: number, phrase: string): Mark {
  if (mood === null) return blank(phrase, "Mood");
  const color = MOOD_COLORS[mood - 1] ?? null;
  return {
    title: `${phrase}. Mood ${mood}`,
    text: span === 7 ? String(mood) : "",
    tone: span === 365 ? "fill" : "empty",
    color: span === 365 ? color : null,
    dot: span === 365 ? null : color,
  };
}

function sleepMark(hours: number | null, span: number, phrase: string): Mark {
  if (hours === null) return blank(phrase, "Sleep");
  const label = formatHours(hours);
  return {
    title: `${phrase}. Sleep ${label} hours`,
    text: span === 365 ? "" : label,
    tone: span === 365 ? "fill" : "empty",
    color: span === 365 ? SLEEP_COLOR : null,
    dot: null,
  };
}

function workoutMark(workout: "yes" | "no" | null, span: number, phrase: string, muted: string): Mark {
  if (workout === "yes") {
    return { title: `${phrase}. Workout yes`, text: span === 365 ? "" : "Yes", tone: "fill", color: WORKOUT_COLOR, dot: null };
  }
  if (workout === "no") {
    return {
      title: `${phrase}. Workout no`,
      text: span === 365 ? "" : "No",
      tone: span === 365 ? "fill" : "empty",
      color: span === 365 ? muted : null,
      dot: null,
    };
  }
  return blank(phrase, "Workout");
}

function countMark(name: string, count: number, one: string, many: string, color: string, span: number, phrase: string): Mark {
  if (count <= 0) return blank(phrase, name);
  return {
    title: `${phrase}. ${name} ${countLabel(count, one, many)}`,
    text: span === 365 ? "" : String(count),
    tone: "fill",
    color,
    dot: null,
  };
}

function trackerMark(
  tracker: Tracker,
  log: TrackerLog | null,
  day: string,
  today: string,
  span: number,
  phrase: string,
  muted: string,
): Mark {
  const tone = trackerTone({
    kind: tracker.kind,
    dailyTarget: tracker.dailyTarget,
    schedule: tracker.schedule,
    log,
    day,
    today,
  });
  if (tracker.isHobby && tone === "miss") return blank(phrase, tracker.name);
  const text = span === 365 ? "" : loggedText(tracker.kind, log, tone, span);
  const color = tone === "fill" ? tracker.color : tone === "skip" && span === 365 ? muted : null;
  let detail = tracker.name;
  if (tone === "skip") detail = `${tracker.name} skipped`;
  else if (tone === "miss" && text === "") detail = `${tracker.name} missed`;
  else if (tone === "miss") detail = `${tracker.name} ${text}, missed`;
  else if (text) detail = `${tracker.name} ${text}`;
  else if (tone === "fill") detail = `${tracker.name} done`;
  return { title: `${phrase}. ${detail}`, text, tone, color, dot: null };
}

function loggedText(kind: TrackerKind, log: TrackerLog | null, tone: TrackerTone, span: number): string {
  if (tone === "skip") return span === 7 ? "Skip" : "–";
  if (!log || log.state !== "done") return "";
  if (kind === "check" || log.value === null || !Number.isFinite(log.value)) return tone === "fill" && span === 7 ? "Done" : "";
  const number = Number.isInteger(log.value) ? String(log.value) : String(Math.round(log.value * 10) / 10);
  return kind === "minutes" && span === 7 ? `${number}m` : number;
}

function blank(phrase: string, name: string): Mark {
  return { title: `${phrase}. ${name}`, text: "", tone: "empty", color: null, dot: null };
}

function dayPhrase(day: string, reading: DayReading): string {
  const written = civilDate(day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${written}, ${READING_LABEL[reading]}`;
}

function formatAverage(values: number[]): string {
  if (values.length === 0) return "—";
  const average = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
  return Number.isInteger(average) ? String(average) : average.toFixed(1);
}

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function rateLabel(rate: { met: number; scheduled: number }): string {
  if (rate.scheduled === 0) return "—";
  return `${rate.met} of ${rate.scheduled}`;
}

function civilDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

function chunk<T>(values: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

function sumChunk(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
