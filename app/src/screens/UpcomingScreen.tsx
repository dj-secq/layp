import { useEffect, useState } from "react";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { TaskRow } from "../components/TaskRow";
import { completeTask, reopenTask, tasksUpcoming } from "../db/tasks";
import type { Task } from "../db/types";
import { addDays, formatDay } from "../lib/dates";
import { useApp } from "../state/AppState";

export function UpcomingScreen() {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const view = useViewLoad(app.civilToday);

  useEffect(() => {
    let cancel = false;
    tasksUpcoming(app.civilToday)
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
  }, [app.civilToday, app.revision]);

  const overdue = tasks.filter((task) => task.dueOn && task.dueOn < app.civilToday);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(app.civilToday, index + 1));
  const visible = [...overdue, ...dates.flatMap((date) => tasks.filter((task) => task.dueOn === date))];

  useEffect(() => {
    app.bindScreen({
      taskIds: visible.map((task) => task.id),
      toggleTask(id) {
        const task = visible.find((item) => item.id === id);
        if (task) void toggle(task);
      },
    });
  });

  async function toggle(task: Task) {
    const result = task.completedAt ? await reopenTask(task.id) : await completeTask(task.id);
    if (result.status === "saved") app.bump();
    else setError("Not saved");
  }

  return (
    <section className="grid gap-4" aria-label="Upcoming">
      <h1 className="page-title screen-head">Upcoming</h1>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {!view.ready ? <Skeleton kind="rows" label="Loading upcoming" /> : null}
      {view.ready && visible.length === 0 ? <p>Nothing scheduled.</p> : null}
      {view.ready && overdue.length > 0 ? <Group label="Overdue" tasks={overdue} onToggle={toggle} /> : null}
      {view.ready ? dates.map((date) => {
        const rows = tasks.filter((task) => task.dueOn === date);
        if (rows.length === 0) return null;
        return <Group key={date} label={formatDay(date)} tasks={rows} onToggle={toggle} />;
      }) : null}
    </section>
  );
}

function Group({ label, tasks, onToggle }: { label: string; tasks: Task[]; onToggle: (task: Task) => void }) {
  const app = useApp();
  return (
    <section className="grid gap-1">
      <h2 className="group-label">{label}</h2>
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          lists={app.lists}
          clock={app.settings.clock}
          selected={app.cursorId === task.id}
          done={Boolean(task.completedAt)}
          onOpen={() => app.setOpenTaskId(task.id)}
          onToggle={() => onToggle(task)}
        />
      ))}
    </section>
  );
}
