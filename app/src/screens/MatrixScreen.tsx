import { useEffect, useState } from "react";
import { patchTask, tasksOpen } from "../db/tasks";
import type { Task } from "../db/types";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { useApp } from "../state/AppState";

const QUADRANTS = [
  { title: "Important and urgent", important: true, urgent: true, tone: "both" },
  { title: "Important", important: true, urgent: false, tone: "important" },
  { title: "Urgent", important: false, urgent: true, tone: "urgent" },
  { title: "Neither", important: false, urgent: false, tone: "neither" },
] as const;

export function MatrixScreen() {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const view = useViewLoad("matrix");

  useEffect(() => {
    let cancel = false;
    tasksOpen()
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

  async function drop(taskId: string, important: boolean, urgent: boolean) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || (task.important === important && task.urgent === urgent)) return;
    const result = await patchTask(task, { important, urgent });
    if (result.status === "saved") app.bump();
    else setError("Not saved");
  }

  return (
    <div className="grid gap-4">
      <h1 className="page-title screen-head">Matrix</h1>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {view.ready ? (
      <div className="grid gap-3 md:grid-cols-2">
        {QUADRANTS.map((quadrant) => {
          const cards = tasks.filter((task) => task.important === quadrant.important && task.urgent === quadrant.urgent);
          return (
            <section
              key={quadrant.title}
              className="panel matrix-quad grid min-h-40 content-start gap-2"
              data-tone={quadrant.tone}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const taskId = event.dataTransfer.getData("text/plain");
                if (taskId) void drop(taskId, quadrant.important, quadrant.urgent);
              }}
            >
              <h2 className="text-[15px] font-bold">{quadrant.title}</h2>
              {cards.length === 0 ? <p className="text-[13px] font-medium">Nothing here</p> : null}
              {cards.map((task) => {
                const color = app.lists.find((list) => list.id === task.listId)?.color ?? "var(--ink-soft)";
                return (
                  <button
                    key={task.id}
                    type="button"
                    draggable
                    className="press btn-secondary items-center justify-start gap-2 text-left"
                    style={{ width: "100%", justifyContent: "flex-start" }}
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
                    onClick={() => app.setOpenTaskId(task.id)}
                  >
                    <span className="priority-mark" style={{ background: color }} aria-hidden />
                    <span className="min-w-0 truncate">{task.title}</span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      ) : (
        <Skeleton kind="matrix" label="Loading the matrix" />
      )}
    </div>
  );
}
