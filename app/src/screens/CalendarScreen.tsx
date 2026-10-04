import { Calendar, CalendarRange, ChevronLeft, ChevronRight, List, Sun } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { patchTask, tasksInRange } from "../db/tasks";
import type { Task, TaskList } from "../db/types";
import { formatClock, type ClockPreference } from "../lib/clock";
import { monthCells, monthLabel, shiftMonth, weekdayLabels, type WeekStart } from "../lib/dates";
import { weekBounds } from "../lib/journal";
import { useApp } from "../state/AppState";

type Mode = "month" | "week" | "day" | "agenda";

const HOUR = 48;
const GUTTER = "64px";

function hourLabel(hour: number, clock: ClockPreference): string {
  if (clock === "24") return String(hour).padStart(2, "0");
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12} ${suffix}`;
}

const MODES = [
  { id: "month", label: "Month", icon: Calendar },
  { id: "week", label: "Week", icon: CalendarRange },
  { id: "day", label: "Day", icon: Sun },
  { id: "agenda", label: "Agenda", icon: List },
] as const;

function listColor(lists: { id: string; color: string }[], listId: string): string {
  return lists.find((list) => list.id === listId)?.color ?? "#ffdc58";
}

export function CalendarScreen() {
  const app = useApp();
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(app.civilToday);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const range = visibleRange(mode, anchor, app.settings.weekStart);
  const view = useViewLoad(`${range.from}|${range.to}`);

  useEffect(() => {
    app.bindScreen({ taskIds: [], toggleTask() {} });
  }, [app]);

  useEffect(() => {
    let cancel = false;
    tasksInRange(range.from, range.to)
      .then((rows) => {
        if (!cancel) {
          view.settle(() => {
            setTasks(rows);
            setError(null);
          });
        }
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [range.from, range.to, app.revision]);

  useEffect(() => {
    if (scrollRef.current && (mode === "week" || mode === "day")) scrollRef.current.scrollTop = 6 * HOUR;
  }, [mode, anchor]);

  function shift(delta: number) {
    const date = Temporal.PlainDate.from(anchor);
    if (mode === "month" || mode === "agenda") {
      const next = shiftMonth(date.year, date.month, delta);
      setAnchor(Temporal.PlainDate.from({ year: next.year, month: next.month, day: 1 }).toString());
      return;
    }
    setAnchor(date.add({ days: mode === "week" ? delta * 7 : delta }).toString());
  }

  return (
    <section className="grid min-w-0 gap-3" aria-label="Calendar">
      <header className="screen-head">
        <h1 className="page-title">Calendar</h1>
      </header>
      <div className="page-head">
        <div className="flex items-center gap-2">
          <Button small aria-label="Previous" onClick={() => shift(-1)}>
            <ChevronLeft size={16} aria-hidden />
          </Button>
          <p className="page-title">{range.label}</p>
          <Button small aria-label="Next" onClick={() => shift(1)}>
            <ChevronRight size={16} aria-hidden />
          </Button>
          <Button variant="secondary" onClick={() => setAnchor(app.civilToday)}>
            Today
          </Button>
        </div>
        <div className="page-tools" role="group" aria-label="Calendar view">
          {MODES.map((item) => {
            const Icon = item.icon;
            return (
              <Button key={item.id} variant={mode === item.id ? "primary" : "secondary"} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                {item.label}
              </Button>
            );
          })}
        </div>
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {!view.ready ? (
        <Skeleton kind={mode === "agenda" ? "rows" : mode === "month" ? "month" : "calendar"} label="Loading the calendar" />
      ) : null}
      {view.ready && mode === "month" ? (
        <MonthGrid
          anchor={anchor}
          today={app.civilToday}
          weekStart={app.settings.weekStart}
          tasks={tasks}
          lists={app.lists}
          onOpen={(id) => app.setOpenTaskId(id)}
          onDay={(iso) => {
            setAnchor(iso);
            setMode("day");
          }}
        />
      ) : null}
      {view.ready && mode === "agenda" ? (
        <Agenda range={range} tasks={tasks} lists={app.lists} clock={app.settings.clock} onOpen={(id) => app.setOpenTaskId(id)} />
      ) : null}
      {view.ready && (mode === "week" || mode === "day") ? (
        <TimeGrid
          dates={range.dates}
          today={app.civilToday}
          tasks={tasks}
          lists={app.lists}
          clock={app.settings.clock}
          scrollRef={scrollRef}
          onOpen={(id) => app.setOpenTaskId(id)}
          onError={setError}
          onSaved={() => app.bump()}
        />
      ) : null}
    </section>
  );
}

function MonthGrid({
  anchor,
  today,
  weekStart,
  tasks,
  lists,
  onOpen,
  onDay,
}: {
  anchor: string;
  today: string;
  weekStart: WeekStart;
  tasks: Task[];
  lists: TaskList[];
  onOpen: (id: string) => void;
  onDay: (iso: string) => void;
}) {
  const date = Temporal.PlainDate.from(anchor);
  const cells = monthCells(date.year, date.month, weekStart);
  return (
    <div className="month-grid">
      {weekdayLabels(weekStart).map((label) => (
        <span key={label} className="weekday-label">
          {label}
        </span>
      ))}
      {cells.map((iso, index) => {
        if (!iso) return <span key={`blank-${index}`} />;
        const rows = tasks.filter((task) => task.dueOn === iso);
        const shown = rows.slice(0, 3);
        return (
          <div key={iso} className="month-cell" data-today={iso === today ? "true" : "false"}>
            <button type="button" className="nums font-bold" onClick={() => onDay(iso)}>
              {Temporal.PlainDate.from(iso).day}
            </button>
            {shown.map((task) => (
              <button
                key={task.id}
                type="button"
                className="cal-chip mt-1"
                style={{ background: listColor(lists, task.listId) }}
                onClick={() => onOpen(task.id)}
              >
                {task.title}
              </button>
            ))}
            {rows.length > 3 ? (
              <button type="button" className="label" onClick={() => onDay(iso)}>
                +{rows.length - 3}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Agenda({
  range,
  tasks,
  lists,
  clock,
  onOpen,
}: {
  range: { dates: string[] };
  tasks: Task[];
  lists: TaskList[];
  clock: ClockPreference;
  onOpen: (id: string) => void;
}) {
  const dates = range.dates.filter((date) => tasks.some((task) => task.dueOn === date));
  if (dates.length === 0) return <p>Nothing scheduled.</p>;
  return (
    <div className="grid gap-3">
      {dates.map((date) => (
        <section key={date}>
          <h2 className="group-label">{Temporal.PlainDate.from(date).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>
          {tasks
            .filter((task) => task.dueOn === date)
            .map((task) => (
              <button key={task.id} type="button" className="task-row w-full text-left" onClick={() => onOpen(task.id)}>
                <span className="row-accent" style={{ background: listColor(lists, task.listId) }} aria-hidden />
                <span className="task-title min-w-0 flex-1 truncate">{task.title}</span>
                <span className="meta nums shrink-0">{task.dueTime ? formatClock(task.dueTime, clock) : "All day"}</span>
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}

function TimeGrid({
  dates,
  today,
  tasks,
  lists,
  clock,
  scrollRef,
  onOpen,
  onError,
  onSaved,
}: {
  dates: string[];
  today: string;
  tasks: Task[];
  lists: TaskList[];
  clock: ClockPreference;
  scrollRef: RefObject<HTMLDivElement | null>;
  onOpen: (id: string) => void;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const columns = useRef<Array<HTMLDivElement | null>>([]);
  const [preview, setPreview] = useState<{ id: string; dueOn: string; minutes: number; duration: number } | null>(null);

  async function commit(task: Task, dueOn: string, minutes: number, duration: number) {
    const dueTime = hhmm(minutes);
    const same = task.dueOn === dueOn && task.dueTime === dueTime && (task.durationMinutes ?? 60) === duration;
    setPreview(null);
    if (same && task.dueTime && task.durationMinutes) return;
    const result = await patchTask(task, { dueOn, dueTime, durationMinutes: duration });
    if (result.status === "saved") onSaved();
    else onError("Not saved");
  }

  function dateAt(x: number, fallback: string): string {
    for (const node of columns.current) {
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right) return node.dataset.date ?? fallback;
    }
    return fallback;
  }

  return (
    <div className="grid gap-2">
      <div className="cal-head" style={{ gridTemplateColumns: `${GUTTER} repeat(${dates.length}, minmax(0, 1fr))` }}>
        <span />
        {dates.map((date) => {
          const plain = Temporal.PlainDate.from(date);
          return (
            <div key={date} className="cal-dayhead" data-today={date === today ? "true" : "false"}>
              <span>{plain.toLocaleString(undefined, { weekday: "short" })}</span>
              <span className="nums">{plain.day}</span>
            </div>
          );
        })}
      </div>
      <div className="cal-allday" style={{ gridTemplateColumns: `${GUTTER} repeat(${dates.length}, minmax(0, 1fr))` }}>
        <span className="label">All day</span>
        {dates.map((date) => (
          <div key={date} className="grid gap-1">
            {tasks
              .filter((task) => task.dueOn === date && !task.dueTime)
              .map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="cal-chip"
                  style={{ background: listColor(lists, task.listId) }}
                  onClick={() => onOpen(task.id)}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    const startY = event.clientY;
                    const startX = event.clientX;
                    const move = (ev: PointerEvent) => {
                      if (Math.abs(ev.clientY - startY) < 6) return;
                      const minutes = minutesFromGrid(ev.clientY, scrollRef.current);
                      setPreview({ id: task.id, dueOn: dateAt(ev.clientX, date), minutes, duration: 60 });
                    };
                    const up = (ev: PointerEvent) => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                      if (Math.abs(ev.clientY - startY) < 8 && Math.abs(ev.clientX - startX) < 8) {
                        setPreview(null);
                        return;
                      }
                      const minutes = minutesFromGrid(ev.clientY, scrollRef.current);
                      void commit(task, dateAt(ev.clientX, date), minutes, task.durationMinutes ?? 60);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                >
                  {task.title}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-columns" style={{ gridTemplateColumns: `${GUTTER} repeat(${dates.length}, minmax(0, 1fr))`, height: 24 * HOUR }}>
          <div>
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="cal-hour nums">
                {hourLabel(hour, clock)}
              </div>
            ))}
          </div>
          {dates.map((date, index) => (
            <div
              key={date}
              className="cal-column"
              data-date={date}
              data-today={date === today ? "true" : "false"}
              ref={(node) => {
                columns.current[index] = node;
              }}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className="cal-slot" />
              ))}
              {tasks
                .filter((task) => (preview?.id === task.id ? preview.dueOn : task.dueOn) === date && (task.dueTime || preview?.id === task.id))
                .map((task) => {
                  const minutes = preview?.id === task.id ? preview.minutes : minutesOf(task.dueTime ?? "09:00");
                  const duration = preview?.id === task.id ? preview.duration : task.durationMinutes ?? 60;
                  return (
                    <div
                      key={task.id}
                      className="cal-block"
                      style={{
                        top: (minutes / 60) * HOUR,
                        height: Math.max(16, (duration / 60) * HOUR),
                        background: listColor(lists, task.listId),
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || (event.target as HTMLElement).dataset.handle === "resize") return;
                        const startY = event.clientY;
                        const startX = event.clientX;
                        let moved = false;
                        const origin = minutes;
                        const move = (ev: PointerEvent) => {
                          if (Math.abs(ev.clientY - startY) < 6 && Math.abs(ev.clientX - startX) < 6) return;
                          moved = true;
                          const delta = snapDelta(ev.clientY - startY);
                          setPreview({
                            id: task.id,
                            dueOn: dateAt(ev.clientX, date),
                            minutes: clampMinute(origin + delta),
                            duration,
                          });
                        };
                        const up = (ev: PointerEvent) => {
                          window.removeEventListener("pointermove", move);
                          window.removeEventListener("pointerup", up);
                          if (!moved) {
                            setPreview(null);
                            return;
                          }
                          const delta = snapDelta(ev.clientY - startY);
                          const dueOn = dateAt(ev.clientX, date);
                          if (delta === 0 && dueOn === date) {
                            setPreview(null);
                            return;
                          }
                          void commit(task, dueOn, clampMinute(origin + delta), task.durationMinutes ?? 60);
                        };
                        window.addEventListener("pointermove", move);
                        window.addEventListener("pointerup", up);
                      }}
                    >
                      <button type="button" className="block w-full truncate text-left font-bold" onClick={() => onOpen(task.id)}>
                        {task.title}
                        {task.dueTime ? <span className="block text-[12px] font-medium">{formatClock(task.dueTime, clock)}</span> : null}
                      </button>
                      <div
                        className="cal-resize"
                        data-handle="resize"
                        aria-label={`Resize ${task.title}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          const startY = event.clientY;
                          const origin = task.durationMinutes ?? 60;
                          const move = (ev: PointerEvent) => {
                            setPreview({
                              id: task.id,
                              dueOn: task.dueOn ?? date,
                              minutes,
                              duration: clampDuration(origin + snapDelta(ev.clientY - startY)),
                            });
                          };
                          const up = (ev: PointerEvent) => {
                            window.removeEventListener("pointermove", move);
                            window.removeEventListener("pointerup", up);
                            const next = clampDuration(origin + snapDelta(ev.clientY - startY));
                            if (next === origin) {
                              setPreview(null);
                              return;
                            }
                            void commit(task, task.dueOn ?? date, minutes, next);
                          };
                          window.addEventListener("pointermove", move);
                          window.addEventListener("pointerup", up);
                        }}
                      />
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function weekLabel(start: string, end: string): string {
  const a = Temporal.PlainDate.from(start);
  const b = Temporal.PlainDate.from(end);
  const monthDay = { month: "short", day: "numeric" } as const;
  if (a.year === b.year && a.month === b.month) return `${a.toLocaleString(undefined, { month: "long" })} ${a.day}–${b.day}, ${a.year}`;
  if (a.year === b.year) return `${a.toLocaleString(undefined, monthDay)} – ${b.toLocaleString(undefined, monthDay)}, ${a.year}`;
  return `${a.toLocaleString(undefined, { ...monthDay, year: "numeric" })} – ${b.toLocaleString(undefined, { ...monthDay, year: "numeric" })}`;
}

function visibleRange(mode: Mode, anchor: string, weekStart: WeekStart): { from: string; to: string; label: string; dates: string[] } {
  const date = Temporal.PlainDate.from(anchor);
  if (mode === "day") {
    return { from: anchor, to: anchor, label: date.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric" }), dates: [anchor] };
  }
  if (mode === "week") {
    const bounds = weekBounds(anchor, weekStart);
    const dates = Array.from({ length: 7 }, (_, index) => Temporal.PlainDate.from(bounds.start).add({ days: index }).toString());
    return { from: bounds.start, to: bounds.end, label: weekLabel(bounds.start, bounds.end), dates };
  }
  const first = Temporal.PlainDate.from({ year: date.year, month: date.month, day: 1 });
  const last = first.with({ day: first.daysInMonth });
  const dates = Array.from({ length: first.daysInMonth }, (_, index) => first.add({ days: index }).toString());
  return { from: first.toString(), to: last.toString(), label: monthLabel(date.year, date.month), dates };
}

function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function hhmm(total: number): string {
  const minutes = clampMinute(total);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function snapDelta(dy: number): number {
  return Math.round(((dy / HOUR) * 60) / 15) * 15;
}

function clampMinute(total: number): number {
  const snapped = Math.round(total / 15) * 15;
  return Math.max(0, Math.min(23 * 60 + 45, snapped));
}

function clampDuration(total: number): number {
  const snapped = Math.round(total / 15) * 15;
  return Math.max(15, Math.min(1440, snapped));
}

function minutesFromGrid(clientY: number, scroll: HTMLDivElement | null): number {
  if (!scroll) return 9 * 60;
  const top = scroll.getBoundingClientRect().top;
  const y = clientY - top + scroll.scrollTop;
  return clampMinute((y / HOUR) * 60);
}
