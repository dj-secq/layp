import { useEffect, useState } from "react";
import { TaskRow } from "../components/TaskRow";
import { deleteFilter, loadFilters, type SavedFilter } from "../db/filters";
import { taskTagLinks } from "../db/tags";
import { completeTask, reopenTask, tasksForPlanner } from "../db/tasks";
import type { Task } from "../db/types";
import { matchFilter, sortTasks } from "../lib/planner";
import { useApp } from "../state/AppState";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";

export function FilterScreen({ filterId }: { filterId: string }) {
  const app = useApp();
  const [filter, setFilter] = useState<SavedFilter | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const view = useViewLoad(filterId);

  useEffect(() => {
    let cancel = false;
    Promise.all([loadFilters(), tasksForPlanner(), taskTagLinks()])
      .then(([filters, rows, links]) => {
        if (cancel) return;
        const current = filters.find((item) => item.id === filterId) ?? null;
        if (!current) {
          view.settle(() => {
            setFilter(null);
            setTasks([]);
          });
          return;
        }
        const tags = new Map<string, string[]>();
        for (const link of links) {
          const list = tags.get(link.taskId) ?? [];
          list.push(link.tagId);
          tags.set(link.taskId, list);
        }
        const matched = rows.filter((task) =>
          matchFilter(
            {
              listId: task.listId,
              priority: task.priority,
              dueOn: task.dueOn,
              completedAt: task.completedAt,
              important: task.important,
              urgent: task.urgent,
              tagIds: tags.get(task.id) ?? [],
            },
            current.rule,
            app.civilToday,
          ),
        );
        view.settle(() => {
          setFilter(current);
          setTasks(sortTasks(matched, "due"));
        });
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [filterId, app.revision, app.civilToday]);

  async function toggle(task: Task) {
    const result = task.completedAt ? await reopenTask(task.id) : await completeTask(task.id);
    if (result.status === "saved") app.bump();
    else setError("Not saved");
  }

  if (view.ready && !filter && !error) return <p className="pt-4">That filter is not here.</p>;

  return (
    <div className="grid gap-4">
      <header className="screen-head">
        <h1 className="page-title">{filter?.name ?? "Filter"}</h1>
      </header>
      {!view.ready ? <Skeleton kind="rows" label="Loading the filter" /> : null}
      {view.ready ? (
      <div>
        <Button
          variant="danger"
          onClick={() => {
            void deleteFilter(filterId).then((result) => {
              if (result.status === "saved") {
                app.goToday();
                app.bump();
              } else setError("Not saved");
            });
          }}
        >
          Delete filter
        </Button>
      </div>
      ) : null}
      {error ? <p className="meta text-danger">{error}</p> : null}
      {view.ready && tasks.length === 0 ? <p>Nothing matches this filter.</p> : null}
      {view.ready ? tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          lists={app.lists}
          clock={app.settings.clock}
          selected={task.id === app.cursorId || task.id === app.openTaskId}
          done={Boolean(task.completedAt)}
          showDueDate
          onOpen={() => app.setOpenTaskId(task.id)}
          onToggle={() => void toggle(task)}
        />
      )) : null}
    </div>
  );
}
