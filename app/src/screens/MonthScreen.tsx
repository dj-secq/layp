import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { daysBetween, loadTrackers, logsBetween, type Tracker, type TrackerLog } from "../db/trackers";
import { averageSleep, leadingHobby, sumMinutes } from "../lib/journal";
import { monthCells, monthLabel, shiftMonth, weekdayLabels } from "../lib/dates";
import { MOOD_COLORS } from "../lib/stickers";
import { useApp } from "../state/AppState";

export function MonthScreen({ year, month }: { year: number; month: number }) {
  const app = useApp();
  const cells = monthCells(year, month, app.settings.weekStart);
  const labels = weekdayLabels(app.settings.weekStart);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [logs, setLogs] = useState<TrackerLog[]>([]);
  const [sleep, setSleep] = useState<Array<number | null>>([]);
  const [workoutDays, setWorkoutDays] = useState(0);
  const [days, setDays] = useState<Map<string, { sleepHours: number | null; workout: string | null; mood: number | null }>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = useViewLoad(`${year}-${month}`);

  useEffect(() => {
    app.bindScreen({ taskIds: [], toggleTask() {} });
  }, [app]);

  useEffect(() => {
    const first = Temporal.PlainDate.from({ year, month, day: 1 });
    const from = first.toString();
    const to = first.with({ day: first.daysInMonth }).toString();
    let cancel = false;
    Promise.all([loadTrackers(false), logsBetween(from, to), daysBetween(from, to)])
      .then(([nextTrackers, nextLogs, nextDays]) => {
        if (cancel) return;
        view.settle(() => {
          setTrackers(nextTrackers);
          setLogs(nextLogs);
          setSleep(nextDays.map((day) => day.sleepHours));
          setWorkoutDays(nextDays.filter((day) => day.workout === "yes").length);
          setDays(new Map(nextDays.map((day) => [day.day, day])));
          setError(null);
        });
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [year, month, app.revision]);

  useEffect(() => {
    const inMonth = cells.filter((iso): iso is string => iso !== null);
    const todayInMonth = inMonth.find((iso) => iso === app.civilToday);
    setSelected(todayInMonth ?? inMonth[0] ?? null);
  }, [year, month, app.civilToday, app.settings.weekStart]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (app.layers > 0 || isTyping(event.target) || !selected) return;
      const index = cells.indexOf(selected);
      const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : 0;
      if (delta !== 0) {
        const next = cells[index + delta];
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        setSelected(next);
        document.querySelector<HTMLElement>(`[data-month-day="${next}"]`)?.focus();
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
  }, [app, cells, selected]);

  const hobbies = trackers.filter((tracker) => tracker.isHobby);
  const average = averageSleep(sleep);
  const cursor = { year, month };

  return (
    <div className="grid min-w-0 gap-3">
      <header className="screen-head">
        <h1 className="page-title">Month</h1>
      </header>
      <div className="flex items-center justify-between gap-2">
        <Button small aria-label="Previous month" onClick={() => app.goMonth(shiftMonth(cursor.year, cursor.month, -1).year, shiftMonth(cursor.year, cursor.month, -1).month)}>
          <ChevronLeft size={16} aria-hidden />
        </Button>
        <p className="page-title">{monthLabel(year, month)}</p>
        <Button small aria-label="Next month" onClick={() => {
          const next = shiftMonth(year, month, 1);
          app.goMonth(next.year, next.month);
        }}>
          <ChevronRight size={16} aria-hidden />
        </Button>
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {view.ready ? <div className="notebook-layout">
      <section className="grid min-w-0 gap-3" aria-label="Month">
        <div className="month-grid">
          {labels.map((label) => (
            <span key={label} className="weekday-label">
              {label}
            </span>
          ))}
          {cells.map((iso, index) =>
            iso ? (
              <MonthCell
                key={iso}
                iso={iso}
                today={iso === app.civilToday}
                selected={iso === selected}
                day={days.get(iso)}
                hobbies={hobbies}
                logs={logs}
                onOpen={() => app.goToday(iso)}
                onSelect={() => setSelected(iso)}
              />
            ) : (
              <span key={`blank-${index}`} />
            ),
          )}
        </div>
      </section>
      <aside className="panel grid content-start gap-3" aria-label="Month totals">
        <h2 className="page-title">Totals</h2>
        <p>
          <span className="meta">Sleep</span>
          <br />
          <span className="nums font-bold">{average === null ? "No sleep" : average}</span>
        </p>
        <p>
          <span className="meta">Workout days</span>
          <br />
          <span className="nums font-bold">{workoutDays}</span>
        </p>
        {hobbies.map((hobby) => (
          <p key={hobby.id}>
            <span className="meta">{hobby.name}</span>
            <br />
            <span className="nums font-bold">
              {sumMinutes(
                logs.filter((log) => log.trackerId === hobby.id),
                Temporal.PlainDate.from({ year, month, day: 1 }).toString(),
                Temporal.PlainDate.from({ year, month, day: 1 }).with({ day: Temporal.PlainDate.from({ year, month, day: 1 }).daysInMonth }).toString(),
              )}{" "}
              min
            </span>
          </p>
        ))}
      </aside>
      </div> : (
        <Skeleton kind="month" label="Loading the month" />
      )}
    </div>
  );
}

function MonthCell({
  iso,
  today,
  selected,
  day,
  hobbies,
  logs,
  onOpen,
  onSelect,
}: {
  iso: string;
  today: boolean;
  selected: boolean;
  day: { sleepHours: number | null; workout: string | null; mood: number | null } | undefined;
  hobbies: Tracker[];
  logs: TrackerLog[];
  onOpen: () => void;
  onSelect: () => void;
}) {
  const mood = day?.mood ?? null;
  const slices = hobbies.map((hobby) => {
    const log = logs.find((item) => item.trackerId === hobby.id && item.day === iso && item.state === "done");
    return { id: hobby.id, color: hobby.color, minutes: log?.value && log.value > 0 ? log.value : 0 };
  });
  const lead = leadingHobby(slices);
  const date = Temporal.PlainDate.from(iso);
  const label = [
    date.toLocaleString(undefined, { month: "long", day: "numeric" }),
    day?.sleepHours != null ? `${day.sleepHours} hours of sleep` : null,
    day?.workout === "yes" ? "workout" : null,
    mood ? `mood ${mood}` : null,
    lead ? "hobby logged" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      className="month-cell"
      data-month-day={iso}
      data-today={today ? "true" : "false"}
      data-mood={mood ? "true" : "false"}
      aria-selected={selected}
      aria-label={label}
      onClick={onOpen}
      onFocus={onSelect}
    >
      <span className="month-day nums">{date.day}</span>
      <span className="month-mid">
        {mood || day?.sleepHours != null || day?.workout === "yes" ? (
          <span className="month-facts">
            {mood ? <span className="mood-dot" style={{ background: MOOD_COLORS[mood - 1] }} aria-hidden /> : null}
            {day?.sleepHours != null ? <span className="month-sleep nums">{day.sleepHours}</span> : null}
            {day?.workout === "yes" ? <span className="month-work">Workout</span> : null}
          </span>
        ) : null}
        {lead ? (
          <span className="month-hobby">
            <span className="hobby-bar" style={{ background: lead.color }} />
            {lead.extra > 0 ? <span className="month-extra nums">+{lead.extra}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
}
