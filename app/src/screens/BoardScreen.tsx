import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Choice } from "../components/Choice";
import { Dialog } from "../components/Dialog";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { createSection, deleteSection, renameSection, reorderSections } from "../db/lists";
import { loadTags, taskTagLinks, type Tag } from "../db/tags";
import { completeTask, moveTaskOnBoard, patchTask, reopenTask, rewriteOrder, tasksForList } from "../db/tasks";
import type { Section, Task } from "../db/types";
import { checklistLines } from "@layp/shared";
import { formatClock, type ClockPreference } from "@layp/shared";
import { formatShortDay } from "@layp/shared";
import { movedIds, sortTasks } from "@layp/shared";
import { compareSections, sectionDeletePlan } from "../lib/sections";
import { clearDragging, clearDrop, enterDrop, leaveDrop, markDragging } from "../lib/drag";
import { Presence } from "../lib/motion";
import { useApp } from "../state/AppState";

export type BoardColumnModel = { id: string; name: string; tasks: Task[] };

export type BoardDrop =
  | { kind: "none" }
  | { kind: "complete"; orderedIds: string[] }
  | { kind: "reorder-done"; orderedIds: string[] }
  | { kind: "reopen"; sectionId: string; orderedIds: string[] }
  | { kind: "move"; sectionId: string; orderedIds: string[] | null };

export function insertCard(columnIds: string[], taskId: string, beforeId: string | null): string[] {
  const rest = columnIds.filter((id) => id !== taskId);
  if (!beforeId) return [...rest, taskId];
  if (beforeId === taskId) {
    const at = columnIds.indexOf(taskId);
    if (at < 0) return [...rest, taskId];
    const next = [...rest];
    next.splice(at, 0, taskId);
    return next;
  }
  const at = rest.indexOf(beforeId);
  if (at < 0) return [...rest, taskId];
  const next = [...rest];
  next.splice(at, 0, taskId);
  return next;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function boardDrop(
  task: { id: string; sectionId: string | null; completedAt: string | null },
  columnId: string,
  beforeId: string | null,
  columnIds: string[],
): BoardDrop {
  const orderedIds = insertCard(columnIds, task.id, beforeId);
  const same = sameIds(columnIds, orderedIds);
  if (columnId === "done") {
    if (!task.completedAt) return { kind: "complete", orderedIds };
    if (same) return { kind: "none" };
    return { kind: "reorder-done", orderedIds };
  }
  if (task.completedAt) return { kind: "reopen", sectionId: columnId, orderedIds };
  if (same && task.sectionId === columnId) return { kind: "none" };
  return { kind: "move", sectionId: columnId, orderedIds: same ? null : orderedIds };
}

export function boardColumns(
  sections: { id: string; name: string; sortOrder: number }[],
  tasks: Task[],
): BoardColumnModel[] {
  const ordered = [...sections].sort(compareSections);
  const firstId = ordered[0]?.id ?? null;
  const open = sortTasks(
    tasks.filter((task) => task.completedAt === null),
    "manual",
  );
  const columns = ordered.map((section) => ({
    id: section.id,
    name: section.name,
    tasks: open.filter((task) => task.sectionId === section.id || (task.sectionId === null && section.id === firstId)),
  }));
  columns.push({
    id: "done",
    name: "Done",
    tasks: sortTasks(
      tasks.filter((task) => task.completedAt !== null),
      "manual",
    ),
  });
  return columns;
}

export function tagsOnCard(
  taskId: string,
  links: { taskId: string; tagId: string }[],
  tags: { id: string; name: string; color: string }[],
): { id: string; name: string; color: string }[] {
  const ids = new Set(links.filter((link) => link.taskId === taskId).map((link) => link.tagId));
  return tags.filter((tag) => ids.has(tag.id)).sort((a, b) => a.name.localeCompare(b.name));
}

function priorityColor(priority: Task["priority"]): string | null {
  if (priority === "none") return null;
  if (priority === "high") return "var(--danger)";
  if (priority === "medium") return "var(--warning)";
  return "var(--ink-soft)";
}

export function BoardScreen() {
  const app = useApp();
  const listId = app.boardListId;
  const list = app.lists.find((item) => item.id === listId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [links, setLinks] = useState<{ taskId: string; tagId: string }[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState("");
  const view = useViewLoad(listId ?? "");
  const sections = app.sections.filter((section) => section.listId === listId).sort(compareSections);
  const columns = boardColumns(sections, tasks);
  const doneColumn = columns.find((column) => column.id === "done");
  const sectionColumns = columns.filter((column) => column.id !== "done");

  useEffect(() => {
    if (!listId) return;
    let cancel = false;
    Promise.all([tasksForList(listId), taskTagLinks(), loadTags()])
      .then(([rows, nextLinks, nextTags]) => {
        if (!cancel) {
          view.settle(() => {
            setTasks(rows);
            setLinks(nextLinks);
            setTags(nextTags);
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

  async function drop(taskId: string, columnId: string, beforeId: string | null) {
    const task = tasks.find((item) => item.id === taskId);
    const column = columns.find((item) => item.id === columnId);
    if (!task || !column) return;
    const plan = boardDrop(task, columnId, beforeId, column.tasks.map((item) => item.id));
    setError(null);
    if (plan.kind === "none") return;
    if (plan.kind === "move") {
      const result = await moveTaskOnBoard(task.id, plan.sectionId, plan.orderedIds);
      if (result.status === "saved") app.bump();
      else setError("Not saved");
      return;
    }
    if (plan.kind === "reorder-done") {
      try {
        await rewriteOrder(plan.orderedIds);
        app.bump();
      } catch {
        setError("Not saved");
      }
      return;
    }
    if (plan.kind === "complete") {
      const result = await completeTask(task.id);
      if (result.status !== "saved") {
        setError("Not saved");
        return;
      }
      try {
        await rewriteOrder(plan.orderedIds);
      } catch {
        setError("Not saved");
      }
      app.bump();
      return;
    }
    const reopened = await reopenTask(task.id);
    if (reopened.status !== "saved") {
      setError("Not saved");
      return;
    }
    const moved = await patchTask(reopened.row, { sectionId: plan.sectionId });
    if (moved.status !== "saved") {
      setError("Not saved");
      app.bump();
      return;
    }
    try {
      await rewriteOrder(plan.orderedIds);
    } catch {
      setError("Not saved");
    }
    app.bump();
  }

  async function addSection() {
    if (!listId) return;
    const result = await createSection(listId, sectionName);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setSectionName("");
    setError(null);
    await app.refreshLists();
    app.bump();
  }

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
      {view.ready ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {sectionColumns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              sections={sections}
              listColor={list.color}
              clock={app.settings.clock}
              tagsFor={(taskId) => tagsOnCard(taskId, links, tags)}
              onDrop={(taskId, beforeId) => void drop(taskId, column.id, beforeId)}
            />
          ))}
          <BoardNewSection name={sectionName} onName={setSectionName} onAdd={() => void addSection()} />
          {doneColumn ? (
            <BoardColumn
              column={doneColumn}
              sections={sections}
              listColor={list.color}
              clock={app.settings.clock}
              tagsFor={(taskId) => tagsOnCard(taskId, links, tags)}
              onDrop={(taskId, beforeId) => void drop(taskId, doneColumn.id, beforeId)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BoardNewSection({ name, onName, onAdd }: { name: string; onName: (name: string) => void; onAdd: () => void }) {
  return (
    <div className="grid w-64 shrink-0 content-start gap-2">
      <input
        className="field"
        value={name}
        placeholder="New section"
        aria-label="New section"
        onChange={(event) => onName(event.target.value)}
      />
      <Button small onClick={onAdd}>
        Add section
      </Button>
    </div>
  );
}

export function BoardColumn({
  column,
  sections,
  listColor,
  clock,
  tagsFor,
  onDrop,
}: {
  column: BoardColumnModel;
  sections: Section[];
  listColor: string;
  clock: ClockPreference;
  tagsFor: (taskId: string) => { id: string; name: string; color: string }[];
  onDrop: (taskId: string, beforeId: string | null) => void;
}) {
  const app = useApp();
  const section = sections.find((item) => item.id === column.id) ?? null;
  const index = sections.findIndex((item) => item.id === column.id);
  const last = sections.length < 2;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(section?.name ?? column.name);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false);
  const plan = section ? sectionDeletePlan(sections, section.id) : null;
  const target = plan && "targetId" in plan ? sections.find((item) => item.id === plan.targetId) : null;

  function startRename() {
    if (!section) return;
    busy.current = false;
    setDraft(section.name);
    setError(null);
    setRenaming(true);
  }

  function cancelRename() {
    busy.current = true;
    setDraft(section?.name ?? column.name);
    setError(null);
    setRenaming(false);
  }

  async function commitRename() {
    if (!section || busy.current) return;
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
    if (!section) return;
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
    <section
      className="panel board-column flex max-h-[calc(100vh-10rem)] w-64 shrink-0 flex-col gap-2"
      onDragEnter={enterDrop}
      onDragLeave={leaveDrop}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        clearDrop(event);
        event.preventDefault();
        const taskId = event.dataTransfer.getData("text/plain");
        if (taskId) onDrop(taskId, null);
      }}
    >
      {section && renaming ? (
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
        <h2 className="text-[15px] font-bold">{column.name}</h2>
      )}
      {section ? (
        <div className="flex flex-wrap gap-1">
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
      <Presence open={Boolean(section && deleting && target)}>
        {section && deleting && target ? (
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
      </Presence>
      <div className="grid min-h-0 gap-2 overflow-y-auto">
        {column.tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            listColor={listColor}
            clock={clock}
            tags={tagsFor(task.id)}
            onOpen={() => app.setOpenTaskId(task.id)}
            onDrop={(taskId) => onDrop(taskId, task.id)}
          />
        ))}
      </div>
    </section>
  );
}

export function BoardCard({
  task,
  listColor,
  clock,
  tags,
  onOpen,
  onDrop,
}: {
  task: Task;
  listColor: string;
  clock: ClockPreference;
  tags: { name: string; color: string }[];
  onOpen: () => void;
  onDrop: (taskId: string) => void;
}) {
  const priority = priorityColor(task.priority);
  const lines = checklistLines(task.notes);
  const done = lines.filter((line) => line.done).length;
  const firstTag = tags[0];
  const extraTags = Math.max(0, tags.length - 1);
  const due = task.dueOn ? formatShortDay(task.dueOn) : null;
  const time = task.dueTime ? formatClock(task.dueTime, clock) : null;
  const showFacts = due !== null || time !== null || lines.length > 0 || firstTag !== undefined;

  return (
    <button
      type="button"
      draggable
      className="press board-card btn-secondary w-full items-start justify-start gap-2 text-left"
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.effectAllowed = "move";
        markDragging(event);
      }}
      onDragEnd={clearDragging}
      onDragEnter={(event) => {
        enterDrop(event);
        event.stopPropagation();
      }}
      onDragLeave={(event) => {
        leaveDrop(event);
        event.stopPropagation();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        clearDrop(event);
        event.preventDefault();
        event.stopPropagation();
        const taskId = event.dataTransfer.getData("text/plain");
        if (taskId) onDrop(taskId);
      }}
      onClick={onOpen}
    >
      <span className="priority-mark mt-1.5" style={{ background: listColor }} aria-hidden />
      {priority ? <span className="priority-mark mt-1.5" style={{ background: priority }} title={task.priority} /> : null}
      <span className="grid min-w-0 gap-1">
        <span className="truncate">{task.title}</span>
        {showFacts ? (
          <span className="meta flex flex-wrap items-center gap-2">
            {due ? <span>{due}</span> : null}
            {time ? <span>{time}</span> : null}
            {lines.length > 0 ? (
              <span>
                {done}/{lines.length}
              </span>
            ) : null}
            {firstTag ? (
              <span className="inline-flex items-center gap-1">
                <span className="priority-mark" style={{ background: firstTag.color }} aria-hidden />
                <span>{firstTag.name}</span>
                {extraTags > 0 ? <span>+{extraTags}</span> : null}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
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
