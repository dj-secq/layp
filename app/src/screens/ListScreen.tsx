import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { Choice } from "../components/Choice";
import { Dialog } from "../components/Dialog";
import { TaskRow } from "../components/TaskRow";
import { createSection, deleteSection, firstSectionId, renameSection, reorderSections } from "../db/lists";
import { completeTask, createTask, reopenTask, rewriteOrder, tasksForList } from "../db/tasks";
import type { Section, Task } from "../db/types";
import { movedIds, sortTasks, type TaskSort } from "@layp/shared";
import { compareSections, sectionDeletePlan } from "../lib/sections";
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
  const sections = app.sections.filter((section) => section.listId === listId).sort(compareSections);
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
          sections={sections}
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
      </div>
      {view.ready && loose.length > 0 ? (
        <SectionBlock
          section={{ id: "loose", listId, name: "No section", sortOrder: 0, updatedAt: "" }}
          sections={[]}
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

export function SectionBlock({
  section,
  sections,
  tasks,
  enteredId,
  sortMode,
  onToggle,
  onMove,
}: {
  section: Section;
  sections: Section[];
  tasks: Task[];
  enteredId: string | null;
  sortMode: TaskSort;
  onToggle: (task: Task) => Promise<void>;
  onMove: (id: string, direction: -1 | 1, ids: string[]) => void;
}) {
  const app = useApp();
  const ids = tasks.map((task) => task.id);
  const manageable = section.id !== "loose";
  const index = sections.findIndex((item) => item.id === section.id);
  const last = sections.length < 2;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false);
  const plan = manageable ? sectionDeletePlan(sections, section.id) : null;
  const target = plan && "targetId" in plan ? sections.find((item) => item.id === plan.targetId) : null;

  function startRename() {
    busy.current = false;
    setDraft(section.name);
    setError(null);
    setRenaming(true);
  }

  function cancelRename() {
    busy.current = true;
    setDraft(section.name);
    setError(null);
    setRenaming(false);
  }

  async function commitRename() {
    if (busy.current) return;
    busy.current = true;
    if (draft.trim() === section.name) {
      setError(null);
      setRenaming(false);
      return;
    }
    const result = await renameSection(section, draft);
    if (result.status !== "saved") {
      busy.current = false;
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setError(null);
    setRenaming(false);
    await app.refreshLists();
  }

  function moveSection(direction: -1 | 1) {
    const next = movedIds(
      sections.map((item) => item.id),
      section.id,
      direction,
    );
    if (!next) return;
    void reorderSections(next)
      .then(() => app.refreshLists())
      .catch(() => setError("Not saved"));
  }

  return (
    <section>
      {renaming ? (
        <input
          className="field"
          value={draft}
          maxLength={80}
          aria-label={`Rename ${section.name}`}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelRename();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              void commitRename();
            }
          }}
        />
      ) : (
        <h2 className="group-label">{section.name}</h2>
      )}
      {manageable ? (
        <div className="mt-1 flex flex-wrap gap-1">
          <Button
            small
            aria-label={`Move ${section.name} up`}
            aria-disabled={index <= 0}
            disabled={index <= 0}
            onClick={() => moveSection(-1)}
          >
            Up
          </Button>
          <Button
            small
            aria-label={`Move ${section.name} down`}
            aria-disabled={index < 0 || index >= sections.length - 1}
            disabled={index < 0 || index >= sections.length - 1}
            onClick={() => moveSection(1)}
          >
            Down
          </Button>
          <Button small aria-label={`Rename ${section.name}`} onClick={startRename}>
            Rename
          </Button>
          <Button
            small
            aria-label={`Delete ${section.name}`}
            aria-disabled={last}
            disabled={last}
            onClick={() => {
              if (last || !target) return;
              setDeleting(true);
            }}
          >
            Delete
          </Button>
        </div>
      ) : null}
      {error ? <p className="meta text-danger">{error}</p> : null}
      {deleting && target ? (
        <DeleteSectionDialog
          section={section}
          targetName={target.name}
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            setDeleting(false);
            await app.refreshLists();
            app.bump();
          }}
        />
      ) : null}
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

function DeleteSectionDialog({
  section,
  targetName,
  onClose,
  onDeleted,
}: {
  section: Section;
  targetName: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const result = await deleteSection(section.id, section.listId);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    await onDeleted();
  }

  return (
    <Dialog title="Delete section?" onClose={onClose}>
      <p>Tasks in this section move to {targetName}.</p>
      {error ? <p className="meta mt-2 text-danger">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <Button variant="danger" onClick={() => void remove()}>
          Delete
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
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
