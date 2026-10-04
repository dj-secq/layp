import { useEffect, useState } from "react";
import { completeTask, patchTask, reopenTask, tasksForList } from "../db/tasks";
import type { Task } from "../db/types";
import { Choice } from "../components/Choice";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { useApp } from "../state/AppState";

export function BoardScreen() {
  const app = useApp();
  const listId = app.boardListId;
  const list = app.lists.find((item) => item.id === listId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const view = useViewLoad(listId ?? "");
  const sections = app.sections.filter((section) => section.listId === listId).sort((a, b) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    if (!listId) return;
    let cancel = false;
    tasksForList(listId)
      .then((rows) => {
        if (!cancel) view.settle(() => setTasks(rows));
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [listId, app.revision]);

  if (!listId || !list) {
    return (
      <div className="grid gap-3">
        <h1 className="page-title screen-head">Board</h1>
        <p>Choose a list.</p>
        <div className="flex flex-wrap gap-2">
          {app.lists.map((item) => (
            <button key={item.id} type="button" className="press btn-secondary" onClick={() => app.setBoardListId(item.id)}>
              {item.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  async function drop(taskId: string, target: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    setError(null);
    if (target === "done") {
      if (task.completedAt) return;
      const result = await completeTask(task.id);
      if (result.status === "saved") app.bump();
      else setError("Not saved");
      return;
    }
    if (task.completedAt) {
      const reopened = await reopenTask(task.id);
      if (reopened.status !== "saved") {
        setError("Not saved");
        return;
      }
      const moved = await patchTask(reopened.row, { sectionId: target });
      if (moved.status === "saved") app.bump();
      else setError("Not saved");
      return;
    }
    if (task.sectionId === target) return;
    const moved = await patchTask(task, { sectionId: target });
    if (moved.status === "saved") app.bump();
    else setError("Not saved");
  }

  const columns = [
    ...sections.map((section) => ({ id: section.id, name: section.name, tasks: tasks.filter((task) => !task.completedAt && task.sectionId === section.id) })),
    { id: "done", name: "Done", tasks: tasks.filter((task) => task.completedAt) },
  ];

  return (
    <div className="grid min-w-0 gap-4">
      <header className="screen-head">
        <h1 className="page-title">Board</h1>
      </header>
      <div className="page-head">
        <h2 className="page-title">{list.name}</h2>
        <div className="page-tools">
          <Choice
            label="List"
            value={listId}
            options={app.lists.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(id) => app.setBoardListId(id)}
          />
        </div>
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {!view.ready ? <Skeleton kind="board" label="Loading the board" /> : null}
      {view.ready ? <div className="flex gap-3 overflow-auto pb-2">
        {columns.map((column) => (
          <section
            key={column.id}
            className="panel grid w-64 shrink-0 content-start gap-2"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const taskId = event.dataTransfer.getData("text/plain");
              if (taskId) void drop(taskId, column.id);
            }}
          >
            <h2 className="text-[15px] font-bold">{column.name}</h2>
            {column.tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                draggable
                className="press btn-secondary items-center justify-start gap-2 text-left"
                onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
                onClick={() => app.setOpenTaskId(task.id)}
              >
                <span className="priority-mark" style={{ background: list.color }} aria-hidden />
                <span className="min-w-0 truncate">{task.title}</span>
              </button>
            ))}
          </section>
        ))}
      </div> : null}
    </div>
  );
}
