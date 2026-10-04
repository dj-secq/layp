import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { Choice } from "../components/Choice";
import { TaskRow } from "../components/TaskRow";
import { createSection, firstSectionId, reorderSections } from "../db/lists";
import { completeTask, createTask, reopenTask, rewriteOrder, tasksForList } from "../db/tasks";
import type { Section, Task } from "../db/types";
import { movedIds, sortTasks, type TaskSort } from "../lib/planner";
import { useApp } from "../state/AppState";
import { InlineAdd } from "./InlineAdd";

const sortChoice = new Map<string, TaskSort>();

export function ListScreen({ listId }: { listId: string }) {
  const app = useApp();
  const list = app.lists.find((item) => item.id === listId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [sortMode, setSortMode] = useState<TaskSort>(sortChoice.get(listId) ?? "manual");
  const [sectionName, setSectionName] = useState("");
  const [enteredId, setEnteredId] = useState<string | null>(null);
  const view = useViewLoad(listId);
  const sections = app.sections
    .filter((section) => section.listId === listId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const open = tasks.filter((task) => task.completedAt === null);
  const completed = tasks.filter((task) => task.completedAt !== null);
  const loose = open.filter((task) => !sections.some((section) => section.id === task.sectionId));
  const visible = [
    ...sections.flatMap((section) => open.filter((task) => task.sectionId === section.id)),
    ...loose,
    ...(completedOpen ? completed : []),
  ];

  useEffect(() => {
    let cancel = false;
    tasksForList(listId)
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
  }, [listId, app.revision]);

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
    const result = await createTask({
      title,
      listId,
      sectionId: firstSectionId(app.sections, listId),
    });
    if (result.status === "saved") {
      setEnteredId(result.row.id);
      app.bump();
      return null;
    }
    return result.status === "error" ? result.message : "Not saved";
  }

  if (!list) return <p className="pt-4">That list is not here.</p>;

  return (
    <div className="grid min-w-0 gap-4">
      <header className="screen-head">
        <span
          className="inline-block rounded-[4px] border border-[color:var(--border)]"
          style={{ width: 14, height: 14, background: list.color }}
          aria-hidden
        />
        <h1 className="page-title">{list.name}</h1>
      </header>
      <div className="page-head">
        <div className="page-tools">
        <Choice
          label="Sort"
          value={sortMode}
          options={[
            { value: "manual", label: "Manual" },
            { value: "due", label: "Due date" },
            { value: "priority", label: "Priority" },
            { value: "created", label: "Created" },
          ]}
          onChange={(mode) => {
            const next = mode as TaskSort;
            sortChoice.set(listId, next);
            setSortMode(next);
          }}
        />
        </div>
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
      <InlineAdd label={`Add a task to ${list.name}`} onAdd={add} />
      {view.ready && open.length === 0 ? <p>Add a task.</p> : null}
      {!view.ready ? <Skeleton kind="rows" label="Loading the list" /> : null}
      {view.ready ? sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          tasks={sortTasks(open.filter((task) => task.sectionId === section.id), sortMode)}
          enteredId={enteredId}
          sortMode={sortMode}
          onToggle={toggle}
          onMove={(id, direction, ids) => {
            const next = movedIds(ids, id, direction);
            if (next) void rewriteOrder(next).then(() => app.bump());
          }}
        />
      )) : null}
      <div className="flex flex-wrap gap-2">
        <input className="field" value={sectionName} placeholder="New section" aria-label="New section" onChange={(event) => setSectionName(event.target.value)} />
        <Button
          small
          onClick={() => {
            void createSection(listId, sectionName).then(async (result) => {
              if (result.status === "saved") {
                setSectionName("");
                await app.refreshLists();
                app.bump();
              } else setError(result.status === "error" ? result.message : "Not saved");
            });
          }}
        >
          Add section
        </Button>
        {sections.length > 1 ? (
          <Button
            small
            onClick={() => {
              const ids = sections.map((section) => section.id);
              const next = movedIds(ids, ids[0], 1);
              if (next) void reorderSections(next).then(() => void app.refreshLists());
            }}
          >
            Move first section down
          </Button>
        ) : null}
      </div>
      {view.ready && loose.length > 0 ? (
        <SectionBlock
          section={{ id: "loose", listId, name: "No section", sortOrder: 0 }}
          tasks={sortTasks(loose, sortMode)}
          enteredId={enteredId}
          sortMode={sortMode}
          onToggle={toggle}
          onMove={(id, direction, ids) => {
            const next = movedIds(ids, id, direction);
            if (next) void rewriteOrder(next).then(() => app.bump());
          }}
        />
      ) : null}
      {view.ready && completed.length > 0 ? (
        <div>
          <button type="button" className="group-label" aria-expanded={completedOpen} onClick={() => setCompletedOpen((value) => !value)}>
            <span>Completed {completed.length}</span>
            <span>{completedOpen ? "Hide" : "Show"}</span>
          </button>
          {completedOpen
            ? completed.map((task) => (
                <Row key={task.id} task={task} done onToggle={toggle} />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function SectionBlock({
  section,
  tasks,
  enteredId,
  sortMode,
  onToggle,
  onMove,
}: {
  section: Section;
  tasks: Task[];
  enteredId: string | null;
  sortMode: TaskSort;
  onToggle: (task: Task) => Promise<void>;
  onMove: (id: string, direction: -1 | 1, ids: string[]) => void;
}) {
  const ids = tasks.map((task) => task.id);
  return (
    <section>
      <h2 className="group-label">{section.name}</h2>
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Row task={task} done={false} enter={task.id === enteredId} onToggle={onToggle} />
          </div>
          {sortMode === "manual" ? (
            <div className="flex gap-1">
              <Button small aria-label={`Move ${task.title} up`} onClick={() => onMove(task.id, -1, ids)}>
                Up
              </Button>
              <Button small aria-label={`Move ${task.title} down`} onClick={() => onMove(task.id, 1, ids)}>
                Down
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Row({ task, done, enter = false, onToggle }: { task: Task; done: boolean; enter?: boolean; onToggle: (task: Task) => Promise<void> }) {
  const app = useApp();
  return (
    <TaskRow
      task={task}
      lists={app.lists}
      clock={app.settings.clock}
      selected={task.id === app.cursorId || task.id === app.openTaskId}
      done={done}
      enter={enter}
      onOpen={() => app.setOpenTaskId(task.id)}
      onToggle={() => void onToggle(task)}
    />
  );
}
