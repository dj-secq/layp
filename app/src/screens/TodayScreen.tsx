import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { DayRecord } from "../components/DayRecord";
import { MonthPicker } from "../components/MonthPicker";
import { TaskRow } from "../components/TaskRow";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { firstSectionId } from "../db/lists";
import { loadUnfiredReminders, markFired } from "../db/reminders";
import { completeTask, createTask, reopenTask, tasksForDate } from "../db/tasks";
import type { Task } from "../db/types";
import { addDays, formatDay } from "../lib/dates";
import { reminderLabel, scheduleReminders, splitByHorizon, type ScheduledReminder } from "../lib/remind";
import { groupTasksForDay } from "../lib/today";
import { useApp } from "../state/AppState";
import { InlineAdd } from "./InlineAdd";

export function TodayScreen({ date }: { date: string }) {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [enteredId, setEnteredId] = useState<string | null>(null);
  const view = useViewLoad(date);
  const groups = groupTasksForDay(tasks, date, app.civilToday);
  const inbox = app.lists.find((list) => list.isInbox);
  const visible = [
    ...groups.pinned,
    ...groups.overdue,
    ...groups.scheduled,
    ...(completedOpen ? groups.completed : []),
  ];

  useEffect(() => {
    let cancel = false;
    tasksForDate(date, app.civilToday)
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
  }, [date, app.civilToday, app.revision]);

  useEffect(() => {
    app.bindScreen({
      taskIds: visible.map((task) => task.id),
      toggleTask(id) {
        const task = visible.find((item) => item.id === id);
        if (task) void toggle(task);
      },
    });
    return () => app.bindScreen({ taskIds: [], toggleTask() {} });
  });

  async function toggle(task: Task) {
    const result = task.completedAt ? await reopenTask(task.id) : await completeTask(task.id);
    if (result.status === "saved") {
      if (!task.completedAt) setCompletedOpen(true);
      app.bump();
    } else setError("Not saved");
  }

  async function add(title: string): Promise<string | null> {
    if (!inbox) return "Not saved";
    const result = await createTask({
      title,
      listId: inbox.id,
      sectionId: firstSectionId(app.sections, inbox.id),
      dueOn: date,
    });
    if (result.status === "saved") {
      setEnteredId(result.row.id);
      app.bump();
      return null;
    }
    return result.status === "error" ? result.message : "Not saved";
  }

  const open = groups.pinned.length + groups.overdue.length + groups.scheduled.length === 0;

  return (
    <div className="today-page grid gap-4">
      <header className="screen-head">
        <h1 className="page-title">Today</h1>
      </header>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button small aria-label="Previous day" onClick={() => app.goToday(addDays(date, -1))}>
          <ChevronLeft size={18} aria-hidden />
        </Button>
        <div className="relative">
          <button type="button" className="page-title rounded-lg px-1 py-1 text-left" onClick={() => setPicker((open) => !open)}>
            {formatDay(date)}
          </button>
          {picker ? (
            <MonthPicker
              value={date}
              weekStart={app.settings.weekStart}
              onPick={(iso) => {
                app.goToday(iso);
                setPicker(false);
              }}
              onClose={() => setPicker(false)}
            />
          ) : null}
        </div>
        <Button small aria-label="Next day" onClick={() => app.goToday(addDays(date, 1))}>
          <ChevronRight size={18} aria-hidden />
        </Button>
        {date !== app.civilToday ? (
          <Button variant="primary" onClick={() => app.goToday(app.civilToday)}>
            Today
          </Button>
        ) : null}
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {view.ready ? <div className="today-grid">
        <section className="min-w-0" aria-label="Tasks">
          {app.notificationPermission === "denied" ? <DueReminders /> : null}
          <InlineAdd label="Add a task for this day" onAdd={add} />
          {open ? <p className="mt-4">Nothing scheduled.</p> : null}
          <TaskGroup label="Pinned" tasks={groups.pinned} enteredId={enteredId} app={app} onToggle={toggle} />
          <TaskGroup label="Overdue" tasks={groups.overdue} enteredId={enteredId} showDueDate app={app} onToggle={toggle} />
          <TaskGroup label="" tasks={groups.scheduled} enteredId={enteredId} app={app} onToggle={toggle} />
          {groups.completed.length > 0 ? (
            <div>
              <button type="button" className="group-label" aria-expanded={completedOpen} onClick={() => setCompletedOpen((value) => !value)}>
                <span>Completed {groups.completed.length}</span>
                <span>{completedOpen ? "Hide" : "Show"}</span>
              </button>
              {completedOpen
                ? groups.completed.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      lists={app.lists}
                      clock={app.settings.clock}
                      selected={task.id === app.cursorId || task.id === app.openTaskId}
                      done
                      enter={task.id === enteredId}
                      onOpen={() => app.setOpenTaskId(task.id)}
                      onToggle={() => void toggle(task)}
                    />
                  ))
                : null}
            </div>
          ) : null}
        </section>
        <DayRecord date={date} />
      </div> : (
        <Skeleton kind="rows" label="Loading today" />
      )}
    </div>
  );
}

function DueReminders() {
  const app = useApp();
  const [rows, setRows] = useState<ScheduledReminder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    loadUnfiredReminders()
      .then((loaded) => {
        if (cancel) return;
        const scheduled = scheduleReminders(loaded, Temporal.Now.timeZoneId());
        setRows(splitByHorizon(scheduled, Temporal.Now.instant().toString()).due);
        setError(null);
      })
      .catch(() => {
        if (!cancel) setError("Not saved");
      });
    return () => {
      cancel = true;
    };
  }, [app.revision]);

  if (error) return <p className="meta text-danger">{error}</p>;
  if (rows.length === 0) return null;

  async function settle(row: ScheduledReminder, open: boolean) {
    try {
      await markFired([row.id]);
      if (open) app.setOpenTaskId(row.taskId);
      app.bump();
    } catch {
      setError("Not saved");
    }
  }

  return (
    <div>
      <h3 className="group-label">Reminders</h3>
      {rows.map((row) => (
        <div key={row.id} className="task-row">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void settle(row, true)}>
            <span className="task-title block truncate">{row.title}</span>
            <span className="meta">
              {row.listName} · {reminderLabel(row.minutesBefore)}
            </span>
          </button>
          <Button small variant="ghost" onClick={() => void settle(row, false)}>
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
}

function TaskGroup({
  label,
  tasks,
  showDueDate,
  enteredId,
  app,
  onToggle,
}: {
  label: string;
  tasks: Task[];
  showDueDate?: boolean;
  enteredId: string | null;
  app: ReturnType<typeof useApp>;
  onToggle: (task: Task) => Promise<void>;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      {label ? <h3 className="group-label">{label}</h3> : null}
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          lists={app.lists}
          clock={app.settings.clock}
          selected={task.id === app.cursorId || task.id === app.openTaskId}
          done={false}
          showDueDate={showDueDate}
          enter={task.id === enteredId}
          onOpen={() => app.setOpenTaskId(task.id)}
          onToggle={() => void onToggle(task)}
        />
      ))}
    </div>
  );
}
