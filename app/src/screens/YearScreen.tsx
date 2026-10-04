import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { completedDaysBetween, daysBetween, loadTrackers, logsBetween, type Tracker, type TrackerLog } from "../db/trackers";
import { monthCells, monthLabel, weekdayLabels } from "../lib/dates";
import { cellScheduled, dayShownUp, isSuccess } from "../lib/journal";
import { MOOD_COLORS } from "../lib/stickers";
import { sleepRangeLabel, YEAR_MODE_LABELS, yearBarColor, yearModes, type YearMode } from "../lib/yearMark";
import { useApp } from "../state/AppState";

export function YearScreen({ year }: { year: number }) {
  const app = useApp();
  const [mode, setMode] = useState<YearMode>("mood");
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [logs, setLogs] = useState<Map<string, TrackerLog>>(new Map());
  const [days, setDays] = useState<Map<string, { mood: number | null; sleepHours: number | null; workout: "yes" | "no" | null }>>(new Map());
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = useViewLoad(String(year));

  useEffect(() => {
    app.bindScreen({ taskIds: [], toggleTask() {} });
  }, [app]);

  useEffect(() => {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    let cancel = false;
    Promise.all([loadTrackers(false), logsBetween(from, to), daysBetween(from, to), completedDaysBetween(from, to)])
      .then(([nextTrackers, nextLogs, nextDays, nextCompleted]) => {
        if (cancel) return;
        view.settle(() => {
          setTrackers(nextTrackers);
          setLogs(new Map(nextLogs.map((log) => [`${log.trackerId}|${log.day}`, log])));
          setDays(new Map(nextDays.map((day) => [day.day, { mood: day.mood, sleepHours: day.sleepHours, workout: day.workout }])));
          setCompleted(new Set(nextCompleted));
          setError(null);
        });
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [year, app.revision]);

  useEffect(() => {
    setSelected(app.civilToday.startsWith(`${year}-`) ? app.civilToday : `${year}-01-01`);
  }, [year, app.civilToday]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (app.layers > 0 || isTyping(event.target) || !selected) return;
      const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : 0;
      if (delta !== 0) {
        const next = Temporal.PlainDate.from(selected).add({ days: delta });
        if (next.year !== year) return;
        event.preventDefault();
        event.stopPropagation();
        const iso = next.toString();
        setSelected(iso);
        document.querySelector<HTMLElement>(`[data-year-day="${iso}"]`)?.focus();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        app.goToday(selected);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [app, selected, year]);

  return (
    <section className="grid min-w-0 gap-3" aria-label="Year">
      <header className="screen-head">
        <h1 className="page-title">Year</h1>
      </header>
      <div className="page-head">
        <div className="flex items-center gap-2">
          <Button small aria-label="Previous year" onClick={() => app.goYear(year - 1)}>
            <ChevronLeft size={16} aria-hidden />
          </Button>
          <p className="page-title">{year}</p>
          <Button small aria-label="Next year" onClick={() => app.goYear(year + 1)}>
            <ChevronRight size={16} aria-hidden />
          </Button>
        </div>
        <div className="page-tools" role="group" aria-label="Color mode">
          {yearModes.map((item) => (
            <Button key={item} variant={mode === item ? "primary" : "secondary"} aria-pressed={mode === item} onClick={() => setMode(item)}>
              {YEAR_MODE_LABELS[item]}
            </Button>
          ))}
        </div>
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {view.ready ? (
      <>
      <div className="year-months">
        {Array.from({ length: 12 }, (_, index) => {
          const month = index + 1;
          const cells = monthCells(year, month, app.settings.weekStart);
          return (
            <section key={month} className="grid gap-1">
              <h2 className="label">{monthLabel(year, month)}</h2>
              <div className="year-grid">
                {weekdayLabels(app.settings.weekStart).map((label) => (
                  <span key={label} className="weekday-label text-[11px]">
                    {label.slice(0, 2)}
                  </span>
                ))}
                {cells.map((iso, cellIndex) =>
                  iso ? (
                    <YearCell
                      key={iso}
                      iso={iso}
                      today={iso === app.civilToday}
                      mode={mode}
                      selected={iso === selected}
                      trackers={trackers}
                      logs={logs}
                      day={days.get(iso)}
                      taskCompleted={completed.has(iso)}
                      onOpen={() => app.goToday(iso)}
                      onSelect={() => setSelected(iso)}
                    />
                  ) : (
                    <span key={`blank-${month}-${cellIndex}`} />
                  ),
                )}
              </div>
            </section>
          );
        })}
      </div>
      <YearKey mode={mode} sleepHours={[...days.values()].map((day) => day.sleepHours)} />
      </>
      ) : (
        <Skeleton kind="year" label="Loading the year" />
      )}
    </section>
  );
}

function YearCell({
  iso,
  today,
  mode,
  selected,
  trackers,
  logs,
  day,
  taskCompleted,
  onOpen,
  onSelect,
}: {
  iso: string;
  today: boolean;
  mode: YearMode;
  selected: boolean;
  trackers: Tracker[];
  logs: Map<string, TrackerLog>;
  day: { mood: number | null; sleepHours: number | null; workout: "yes" | "no" | null } | undefined;
  taskCompleted: boolean;
  onOpen: () => void;
  onSelect: () => void;
}) {
  const hobbies = trackers.filter((tracker) => tracker.isHobby);
  let hobbyMinutes = 0;
  let hobbyColor: string | null = null;
  let bestHobby = 0;
  for (const hobby of hobbies) {
    const log = logs.get(`${hobby.id}|${iso}`);
    const minutes = log?.state === "done" && log.value && log.value > 0 ? log.value : 0;
    hobbyMinutes += minutes;
    if (minutes > bestHobby) {
      bestHobby = minutes;
      hobbyColor = hobby.color;
    }
  }
  const trackerDone = trackers.some((tracker) => {
    if (tracker.isHobby || !cellScheduled(tracker.schedule, iso)) return false;
    const log = logs.get(`${tracker.id}|${iso}`);
    return isSuccess(tracker.kind, tracker.dailyTarget, log ? { day: log.day, state: log.state, value: log.value } : null);
  });
  const shown = dayShownUp({
    taskCompleted,
    workoutYes: day?.workout === "yes",
    hobbyMinutes,
    trackerDone,
  });
  const mood = day?.mood ?? null;
  const color = yearBarColor({
    mode,
    mood,
    shown,
    sleepHours: day?.sleepHours ?? null,
    workoutYes: day?.workout === "yes",
    taskCompleted,
    hobbyColor,
  });
  const date = Temporal.PlainDate.from(iso);
  const summary = [
    date.toLocaleString(undefined, { month: "short", day: "numeric" }),
    mode === "mood" && mood ? `mood ${mood}` : null,
    mode === "shown" && shown ? "shown up" : null,
    mode === "sleep" && day?.sleepHours != null ? `${day.sleepHours} hours sleep` : null,
    mode === "workout" && day?.workout === "yes" ? "workout" : null,
    mode === "tasks" && taskCompleted ? "task completed" : null,
    mode === "hobby" && hobbyMinutes > 0 ? `${hobbyMinutes} hobby minutes` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      className="year-cell nums"
      data-year-day={iso}
      data-today={today ? "true" : "false"}
      aria-selected={selected}
      aria-label={summary}
      title={summary}
      onClick={onOpen}
      onFocus={onSelect}
    >
      <span>{date.day}</span>
      <span className="year-bar" style={{ background: color ?? "transparent" }} aria-hidden />
    </button>
  );
}

function YearKey({ mode, sleepHours }: { mode: YearMode; sleepHours: Array<number | null> }) {
  if (mode === "mood") {
    return (
      <div className="year-key">
        <span className="label">Mood</span>
        {MOOD_COLORS.map((swatch, index) => (
          <span key={swatch} className="inline-flex items-center gap-1 text-[13px]">
            <span className="mood-dot" style={{ background: swatch }} aria-hidden />
            {index + 1}
          </span>
        ))}
      </div>
    );
  }
  const swatch =
    mode === "sleep" ? "#7dd3fc" : mode === "workout" ? "#86efac" : mode === "hobby" ? "#c4b5fd" : "#ffdc58";
  const caption =
    mode === "sleep"
      ? sleepRangeLabel(sleepHours)
      : mode === "workout"
        ? "Workout marked yes"
        : mode === "tasks"
          ? "A task completed"
          : mode === "hobby"
            ? "Hobby with the most minutes"
            : "Shown up";
  return (
    <div className="year-key">
      <span className="year-bar" style={{ background: swatch, width: 28 }} aria-hidden />
      <span className="text-[13px]">{caption}</span>
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
}
