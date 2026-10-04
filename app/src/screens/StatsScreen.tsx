import { useEffect, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { sessionsBetween } from "../db/focus";
import { completedInstants } from "../db/tasks";
import { daysBetween, loadTrackers, logsBetween, type DaySnap, type Tracker, type TrackerLog } from "../db/trackers";
import { averageSleep, isSuccess, sumMinutes, type TrackerKind } from "../lib/journal";
import { civilDay, countsByDay, dayReading, daysAround, sumByDay, trackerRate, trackerTone, type DayReading, type TrackerTone } from "../lib/stats";
import { formatHours } from "../lib/sleep";
import { MOOD_COLORS } from "../lib/stickers";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { useApp } from "../state/AppState";

const RANGES = [7, 28, 365] as const;
const VIEWS = ["days", "bars", "line"] as const;
type StatsView = (typeof VIEWS)[number];
const VIEW_LABELS: Record<StatsView, string> = { days: "Days", bars: "Bars", line: "Line" };
const TASK_COLOR = "#ffdc58";
const FOCUS_COLOR = "#7dd3fc";
const SLEEP_COLOR = "#93c5fd";
const WORKOUT_COLOR = "#86efac";
const READING_LABEL: Record<DayReading, string> = { down: "Down", productive: "Productive", quiet: "Quiet" };

type Mark = {
  title: string;
  text: string;
  tone: TrackerTone;
  color: string | null;
  dot: string | null;
};

type BoardRow = {
  key: string;
  name: string;
  total: string;
  swatch: string | null;
  group: boolean;
  marks: Mark[];
};

type Board = {
  days: string[];
  readings: DayReading[];
  rows: BoardRow[];
  tasks: number[];
  focus: number[];
  empty: boolean;
};

export function StatsScreen() {
  const app = useApp();
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledSpan = useRef<number | null>(null);
  const [span, setSpan] = useState<(typeof RANGES)[number]>(7);
  const [view, setView] = useState<StatsView>("days");
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const load = useViewLoad(String(span));

  useEffect(() => {
    let cancel = false;
    const zone = Temporal.Now.timeZoneId();
    const today = app.civilToday;
    const days = daysAround(today, span);
    const last = days[days.length - 1];
    const start = Temporal.PlainDate.from(days[0]).toZonedDateTime(zone).toInstant();
    const end = Temporal.PlainDate.from(last).add({ days: 1 }).toZonedDateTime(zone).toInstant().subtract({ milliseconds: 1 });
    Promise.all([
      completedInstants(start.toString(), end.toString()),
      sessionsBetween(start.toString(), end.toString()),
      daysBetween(days[0], last),
      loadTrackers(false),
      logsBetween(days[0], last),
    ])
      .then(([completed, sessions, snaps, trackers, logs]) => {
        if (cancel) return;
        load.settle(() => {
          setBoard(buildBoard({ today, days, span, zone, completed, sessions, snaps, trackers, logs }));
          setError(null);
        });
      })
      .catch(() => {
        if (!cancel) load.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [span, app.civilToday, app.revision]);

  useEffect(() => {
    if (view !== "days") {
      scrolledSpan.current = null;
      return;
    }
    if (!board || board.days.length !== span || scrolledSpan.current === span) return;
    const node = scroller.current;
    if (!node) return;
    scrolledSpan.current = span;
    if (node.scrollWidth <= node.clientWidth + 1) return;
    const todayIndex = board.days.indexOf(app.civilToday);
    const cell = node.querySelectorAll<HTMLElement>("thead .stat-colhead")[todayIndex];
    if (!cell || todayIndex < 0) return;
    node.scrollLeft = 0;
    const left = cell.getBoundingClientRect().left - node.getBoundingClientRect().left;
    node.scrollLeft = Math.max(0, left - 180);
  }, [board, span, view, app.civilToday]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      const wide = node.scrollWidth > node.clientWidth + 1;
      const tall = node.scrollHeight > node.clientHeight + 1;
      if (!wide || tall) return;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      node.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [view, board]);

  const shown = board;
  const viewSpan = shown?.days.length ?? span;

  const chartDays = shown && span === 365 ? chunk(shown.days, 7).map((group) => group[0]) : (shown?.days ?? []);
  const taskBars = shown ? (span === 365 ? chunk(shown.tasks, 7).map(sumChunk) : shown.tasks) : [];
  const focusBars = shown ? (span === 365 ? chunk(shown.focus, 7).map(sumChunk) : shown.focus) : [];
  const labels = axisLabels(chartDays);
  const taskTitle = span === 365 ? "Tasks completed, by week" : "Tasks completed";
  const focusTitle = span === 365 ? "Focus minutes, by week" : "Focus minutes";

  return (
    <div className="stats-page">
      <header className="screen-head">
        <h1 className="page-title">Stats</h1>
      </header>
      <div className="page-head">
        <div className="page-tools">
          <div className="page-tools" role="group" aria-label="Range">
            {RANGES.map((range) => (
              <button key={range} type="button" className={span === range ? "press btn-primary" : "press btn-secondary"} onClick={() => setSpan(range)}>
                {range} days
              </button>
            ))}
          </div>
          <div className="page-tools" role="group" aria-label="View">
            {VIEWS.map((item) => (
              <button key={item} type="button" className={view === item ? "press btn-primary" : "press btn-secondary"} aria-pressed={view === item} onClick={() => setView(item)}>
                {VIEW_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {view === "days" ? (
        <p className="stat-key">
          <span>
            <i data-reading="down" /> Down
          </span>
          <span>
            <i data-reading="productive" /> Productive
          </span>
          <span>
            <i data-reading="quiet" /> Quiet
          </span>
          <span>
            <i data-tone="miss" /> Missed
          </span>
        </p>
      ) : null}
      {error ? <p className="meta text-danger">{error}</p> : null}
      {load.ready && shown?.empty ? <p>Complete a task or fill a day, and it will count here.</p> : null}
      {!load.ready ? <Skeleton kind="stats" label="Loading stats" /> : null}
      {load.ready && shown && view === "bars" ? (
        <div className="stat-charts">
          <Chart title={taskTitle} values={taskBars} labels={labels} color={TASK_COLOR} />
          <Chart title={focusTitle} values={focusBars} labels={labels} color={FOCUS_COLOR} />
        </div>
      ) : null}
      {load.ready && shown && view === "line" ? (
        <div className="stat-charts">
          <LineChart title={taskTitle} values={taskBars} labels={labels} color={TASK_COLOR} />
          <LineChart title={focusTitle} values={focusBars} labels={labels} color={FOCUS_COLOR} />
        </div>
      ) : null}
      {load.ready && shown && view === "days" ? (
        <div className="stat-scroll" ref={scroller}>
          <table className="stat-board" data-span={viewSpan} aria-label={`${viewSpan} day stats`}>
            <thead>
              <tr>
                <th className="stat-name stat-corner" scope="col" />
                {shown.days.map((day, index) => {
                  const date = Temporal.PlainDate.from(day);
                  const phrase = dayPhrase(day, shown.readings[index]);
                  const month = date.toLocaleString(undefined, { month: "short" });
                  const showMonth = index === 0 || date.day === 1;
                  const top = viewSpan === 7 ? date.toLocaleString(undefined, { weekday: "short" }) : showMonth ? month : "";
                  return (
                    <th
                      key={day}
                      scope="col"
                      className="stat-colhead"
                      data-reading={shown.readings[index]}
                      data-today={day === app.civilToday ? "true" : "false"}
                      data-month={top ? "true" : "false"}
                      title={phrase}
                      aria-label={phrase}
                    >
                      {viewSpan === 365 ? (
                        top ? <span className="stat-col-month">{top}</span> : null
                      ) : (
                        <span className="stat-col-top">{top}</span>
                      )}
                      {viewSpan === 365 ? null : <span className="stat-col-day">{date.day}</span>}
                      {viewSpan === 7 ? <span className="stat-col-read">{READING_LABEL[shown.readings[index]]}</span> : null}
                      <span className="stat-readbar" data-reading={shown.readings[index]} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((row) => (
                <tr key={row.key} data-rule={row.group ? "group" : undefined}>
                  <th scope="row" className="stat-name" title={row.name}>
                    <span className="stat-name-line">
                      {row.swatch ? <i className="stat-swatch" style={{ background: row.swatch }} aria-hidden /> : <i className="stat-swatch stat-swatch-empty" aria-hidden />}
                      <span className="stat-name-label">{row.name}</span>
                    </span>
                    <span className="stat-name-total">{row.total}</span>
                  </th>
                  {row.marks.map((mark, index) => (
                    <td key={shown.days[index]} className="stat-slot" data-reading={shown.readings[index]}>
                      <span
                        className="stat-mark"
                        data-tone={mark.tone}
                        data-ink={mark.color ? "on-fill" : undefined}
                        style={mark.color ? { background: mark.color } : undefined}
                        title={mark.title}
                      >
                        {mark.dot ? <i className="mood-dot" style={{ background: mark.dot }} aria-hidden /> : null}
                        {mark.text}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function buildBoard(input: {
  today: string;
  days: string[];
  span: number;
  zone: string;
  completed: string[];
  sessions: Array<{ endedAt: string; minutes: number }>;
  snaps: DaySnap[];
  trackers: Tracker[];
  logs: TrackerLog[];
}): Board {
  const { today, days, span, snaps, trackers, logs } = input;
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
  const tasks = countsByDay(days, input.completed.map((instant) => civilDay(instant, input.zone)));
  const focus = sumByDay(
    days,
    input.sessions.map((session) => ({ day: civilDay(session.endedAt, input.zone), amount: session.minutes })),
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
      tasks: tasks[index],
      focus: focus[index],
      workout: snap?.workout === "yes",
      hobbyHits: hobbyHits[index],
      trackerHits: trackerHits[index],
    });
  });
  const phrases = days.map((day, index) => dayPhrase(day, readings[index]));
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
      marks: days.map((_day, index) => moodMark(moods[index], span, phrases[index])),
    },
    {
      key: "sleep",
      name: "Sleep",
      total: sleepAverage === null ? "—" : `${formatHours(sleepAverage)} h`,
      swatch: SLEEP_COLOR,
      group: false,
      marks: days.map((_day, index) => sleepMark(sleepHours[index], span, phrases[index])),
    },
    {
      key: "workout",
      name: "Workout",
      total: countLabel(workoutYes, "day", "days"),
      swatch: WORKOUT_COLOR,
      group: false,
      marks: days.map((day, index) => workoutMark(snapByDay.get(day)?.workout ?? null, span, phrases[index])),
    },
    {
      key: "tasks",
      name: "Tasks",
      total: String(tasks.reduce((sum, count) => sum + count, 0)),
      swatch: TASK_COLOR,
      group: false,
      marks: days.map((_day, index) => countMark("Tasks", tasks[index], "task", "tasks", TASK_COLOR, span, phrases[index])),
    },
    {
      key: "focus",
      name: "Focus",
      total: `${focus.reduce((sum, minutes) => sum + minutes, 0)} min`,
      swatch: FOCUS_COLOR,
      group: false,
      marks: days.map((_day, index) => countMark("Focus", focus[index], "min", "min", FOCUS_COLOR, span, phrases[index])),
    },
  ];

  const hobbies = trackers.filter((tracker) => tracker.isHobby);
  const plain = trackers.filter((tracker) => !tracker.isHobby);
  hobbies.forEach((tracker, index) => {
    rows.push(trackerRow(tracker, logsByTracker.get(tracker.id), logs, days, phrases, today, span, index === 0));
  });
  plain.forEach((tracker, index) => {
    rows.push(trackerRow(tracker, logsByTracker.get(tracker.id), logs, days, phrases, today, span, index === 0));
  });

  const empty =
    logs.length === 0 &&
    tasks.every((count) => count === 0) &&
    focus.every((minutes) => minutes === 0) &&
    snaps.every((snap) => snap.mood === null && snap.sleepHours === null && snap.workout === null);

  return { days, readings, rows, tasks, focus, empty };
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
): BoardRow {
  const ownLogs = logs.filter((log) => log.trackerId === tracker.id);
  const past = trackerRate({
    kind: tracker.kind,
    dailyTarget: tracker.dailyTarget,
    schedule: tracker.schedule,
    logs: ownLogs,
    start: days[0],
    today,
  });
  const todayMet = isSuccess(tracker.kind, tracker.dailyTarget, byDay?.get(today) ?? null);
  const total = tracker.isHobby
    ? `${sumMinutes(ownLogs, days[0], days[days.length - 1])} min`
    : rateLabel({ met: past.met + (todayMet ? 1 : 0), scheduled: past.scheduled + (todayMet ? 1 : 0) });
  return {
    key: tracker.id,
    name: tracker.name,
    total,
    swatch: tracker.color,
    group,
    marks: days.map((day, index) => trackerMark(tracker, byDay?.get(day) ?? null, day, today, span, phrases[index])),
  };
}

function moodMark(mood: number | null, span: number, phrase: string): Mark {
  if (mood === null) return blank(phrase, "Mood");
  const color = MOOD_COLORS[mood - 1];
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

function workoutMark(workout: "yes" | "no" | null, span: number, phrase: string): Mark {
  if (workout === "yes") {
    return { title: `${phrase}. Workout yes`, text: span === 365 ? "" : "Yes", tone: "fill", color: WORKOUT_COLOR, dot: null };
  }
  if (workout === "no") {
    return {
      title: `${phrase}. Workout no`,
      text: span === 365 ? "" : "No",
      tone: span === 365 ? "fill" : "empty",
      color: span === 365 ? "var(--muted)" : null,
      dot: null,
    };
  }
  return blank(phrase, "Workout");
}

function countMark(name: string, count: number, one: string, many: string, color: string, span: number, phrase: string): Mark {
  if (count <= 0) return blank(phrase, name);
  const text = span === 365 ? "" : String(count);
  return {
    title: `${phrase}. ${name} ${countLabel(count, one, many)}`,
    text,
    tone: "fill",
    color,
    dot: null,
  };
}

function trackerMark(tracker: Tracker, log: TrackerLog | null, day: string, today: string, span: number, phrase: string): Mark {
  const tone = trackerTone({
    kind: tracker.kind,
    dailyTarget: tracker.dailyTarget,
    schedule: tracker.schedule,
    log,
    day,
    today,
  });
  // A hobby is time spent, not a daily debt. Only a logged day shows up.
  if (tracker.isHobby && tone === "miss") return blank(phrase, tracker.name);
  const text = span === 365 ? "" : loggedText(tracker.kind, log, tone, span);
  const color = tone === "fill" ? tracker.color : tone === "skip" && span === 365 ? "var(--muted)" : null;
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
  const written = Temporal.PlainDate.from(day).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
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

function Chart({ title, values, labels, color }: { title: string; values: number[]; labels: AxisLabel[]; color: string }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <section className="panel grid gap-2">
      <h2 className="text-[15px] font-bold">
        {title} <span className="label">{total}</span>
      </h2>
      <div className="stat-plot">
        {values.map((value, index) => (
          <span
            key={labels[index]?.day ? `${labels[index].top}-${labels[index].day}-${index}` : index}
            title={tickTitle(labels[index])}
            style={{ height: value === 0 ? 4 : Math.max(8, Math.round((value / max) * 96)), background: value === 0 ? "var(--muted)" : color }}
          />
        ))}
      </div>
      <Axis labels={labels} />
    </section>
  );
}

function LineChart({ title, values, labels, color }: { title: string; values: number[]; labels: AxisLabel[]; color: string }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const width = 640;
  const height = 120;
  const step = values.length === 0 ? 0 : width / values.length;
  const points = values.map((value, index) => `${step * index + step / 2},${height - 8 - (value / max) * (height - 16)}`).join(" ");
  const start = step / 2;
  const end = values.length === 0 ? start : step * (values.length - 1) + step / 2;
  return (
    <section className="panel grid gap-2">
      <h2 className="text-[15px] font-bold">
        {title} <span className="label">{total}</span>
      </h2>
      <svg className="stat-line" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <polyline fill="none" stroke="var(--border)" strokeWidth="1" points={`${start},${height - 8} ${end},${height - 8}`} />
        <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={points} />
      </svg>
      <Axis labels={labels} />
    </section>
  );
}

function Axis({ labels }: { labels: AxisLabel[] }) {
  return (
    <div className="stat-axis">
      {labels.map((label, index) => (
        <span key={`${label.top}-${label.day}-${index}`} className="stat-tick">
          <span className="stat-tick-top">{label.top}</span>
          <span className="nums">{label.day}</span>
        </span>
      ))}
    </div>
  );
}

type AxisLabel = { top: string; day: string };

function axisLabels(days: string[]): AxisLabel[] {
  let lastMonth = "";
  return days.map((day, index) => {
    const date = Temporal.PlainDate.from(day);
    if (days.length <= 7) return { top: date.toLocaleString(undefined, { weekday: "short" }), day: String(date.day) };
    const month = date.toLocaleString(undefined, { month: "short" });
    const top = month === lastMonth && index !== 0 ? "" : month;
    lastMonth = month;
    return { top, day: String(date.day) };
  });
}

function tickTitle(label: AxisLabel | undefined): string | undefined {
  if (!label) return undefined;
  return `${label.top} ${label.day}`.trim();
}

function chunk<T>(values: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

function sumChunk(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
