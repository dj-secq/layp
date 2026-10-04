import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Temporal } from "temporal-polyfill";
import { patchTask, tasksForTimeline } from "../db/tasks";
import type { Task } from "../db/types";
import { addDays } from "../lib/dates";
import { timelineDays, timelineGroups, timelineRanges, type TimelineRange } from "../lib/timeline";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { useApp } from "../state/AppState";

const DAY = 28;
const GUTTER = 180;

const RANGE_LABELS: Record<TimelineRange, string> = {
  "2w": "2 weeks",
  "6w": "6 weeks",
  "3m": "3 months",
};

export function TimelineScreen() {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<TimelineRange>("6w");
  const view = useViewLoad("timeline");

  useEffect(() => {
    let cancel = false;
    tasksForTimeline()
      .then((rows) => {
        if (!cancel) view.settle(() => setTasks(rows));
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [app.revision]);

  const days = timelineDays(app.civilToday, range, app.settings.weekStart);
  const groups = timelineGroups(tasks, app.lists.map((list) => list.id), days[0], days[days.length - 1]);
  const width = GUTTER + days.length * DAY;
  const todayIndex = days.indexOf(app.civilToday);

  function indexOf(day: string): number {
    return Temporal.PlainDate.from(days[0]).until(Temporal.PlainDate.from(day), { largestUnit: "days" }).days;
  }

  function colorOf(task: Task): string {
    return app.lists.find((list) => list.id === task.listId)?.color ?? "#ffdc58";
  }

  function drag(task: Task, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const originX = event.clientX;
    const originY = event.clientY;
    let moved = false;
    const move = (pointer: PointerEvent) => {
      if (Math.abs(pointer.clientX - originX) > 6 || Math.abs(pointer.clientY - originY) > 6) moved = true;
    };
    const up = (pointer: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) {
        app.setOpenTaskId(task.id);
        return;
      }
      const delta = Math.round((pointer.clientX - originX) / DAY);
      if (delta === 0) return;
      const patch: { startOn?: string; dueOn?: string } = {};
      if (task.startOn && task.dueOn) {
        patch.startOn = addDays(task.startOn, delta);
        patch.dueOn = addDays(task.dueOn, delta);
      } else if (task.dueOn) patch.dueOn = addDays(task.dueOn, delta);
      else if (task.startOn) patch.startOn = addDays(task.startOn, delta);
      void patchTask(task, patch).then((result) => {
        if (result.status === "saved") app.bump();
        else setError("Not saved");
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="grid gap-4">
      <header className="screen-head">
        <h1 className="page-title">Timeline</h1>
      </header>
      <div className="page-head">
        <div className="page-tools" role="group" aria-label="Range">
          {timelineRanges.map((id) => (
            <button
              key={id}
              type="button"
              className={range === id ? "press btn-primary" : "press btn-secondary"}
              aria-pressed={range === id}
              onClick={() => setRange(id)}
            >
              {RANGE_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {!view.ready ? <Skeleton kind="timeline" label="Loading the timeline" /> : null}
      {view.ready && groups.length === 0 ? <p>Tasks with a date show up here.</p> : null}
      {view.ready && groups.length > 0 ? (
        <div className="overflow-auto">
          <div className="relative" style={{ width }}>
            {todayIndex >= 0 ? (
              <div className="timeline-today" style={{ left: GUTTER + todayIndex * DAY, width: DAY }} />
            ) : null}
            <div className="timeline-head" style={{ width }}>
              <div className="timeline-name" />
              <div className="timeline-scale" style={{ gridTemplateColumns: `repeat(${days.length}, ${DAY}px)` }}>
                {days.map((day) => {
                  const date = Temporal.PlainDate.from(day);
                  const showMonth = day.endsWith("-01") || day === days[0];
                  return (
                    <span key={day} className="timeline-date" data-today={day === app.civilToday ? "true" : "false"}>
                      <span className="timeline-month">{showMonth ? date.toLocaleString(undefined, { month: "short" }) : ""}</span>
                      <span className="timeline-day nums">{date.day}</span>
                    </span>
                  );
                })}
              </div>
            </div>
            {groups.map((group) => {
              const list = app.lists.find((item) => item.id === group.listId);
              return (
                <section key={group.listId} className="mt-3">
                  <div className="timeline-row" style={{ width }}>
                    <div className="timeline-name gap-2 font-medium">
                      <span className="ml-2 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: list?.color ?? "#ffdc58" }} />
                      <span className="truncate">{list?.name ?? "List"}</span>
                    </div>
                  </div>
                  {group.rows.map((row) => (
                    <TimelineBar key={row.task.id} row={row} width={width} days={days} indexOf={indexOf} color={colorOf(row.task)} onDrag={drag} onOpen={() => app.setOpenTaskId(row.task.id)} />
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimelineBar({
  row,
  width,
  days,
  indexOf,
  color,
  onDrag,
  onOpen,
}: {
  row: { task: Task; depth: number; bar: boolean };
  width: number;
  days: string[];
  indexOf: (day: string) => number;
  color: string;
  onDrag: (task: Task, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
}) {
  const task = row.task;
  const start = task.startOn && task.dueOn ? task.startOn : (task.dueOn ?? task.startOn ?? days[0]);
  const endDay = task.startOn && task.dueOn ? task.dueOn : start;
  const startIndex = Math.max(0, indexOf(start));
  const endIndex = Math.min(days.length - 1, indexOf(endDay));
  const left = GUTTER + startIndex * DAY;
  const barWidth = Math.max(DAY, (endIndex - startIndex + 1) * DAY);
  const mark = !(task.startOn && task.dueOn) && !(task.dueOn && task.durationMinutes);
  return (
    <div className="timeline-row" style={{ width }}>
      <button type="button" className="timeline-name" style={{ paddingLeft: 12 + row.depth * 16 }} onClick={onOpen}>
        <span className="truncate">{task.title}</span>
      </button>
      {row.bar ? (
        <button
          type="button"
          className="timeline-item absolute top-0"
          data-mark={mark ? "true" : "false"}
          style={{
            left: mark ? left : left + 2,
            width: mark ? DAY : barWidth - 4,
            background: mark ? undefined : color,
          }}
          onPointerDown={(event) => onDrag(task, event)}
        >
          {mark ? <span className="timeline-dot" style={{ background: color }} /> : <span className="block truncate">{task.title}</span>}
        </button>
      ) : null}
    </div>
  );
}
