import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { directChildCounts } from "../db/tasks";
import type { Task, TaskList } from "../db/types";
import { formatClock, type ClockPreference } from "../lib/clock";
import { formatShortDay } from "../lib/dates";
import { useApp } from "../state/AppState";

let cachedRevision = Number.NaN;
let cachedCounts = new Map<string, number>();
let pendingCounts: { revision: number; promise: Promise<Map<string, number>> } | null = null;

function loadChildCounts(revision: number): Promise<Map<string, number>> {
  if (cachedRevision === revision) return Promise.resolve(cachedCounts);
  if (pendingCounts?.revision === revision) return pendingCounts.promise;
  const promise = directChildCounts()
    .then((counts) => {
      if (!(cachedRevision > revision)) {
        cachedCounts = counts;
        cachedRevision = revision;
      }
      return counts;
    })
    .finally(() => {
      if (pendingCounts?.revision === revision) pendingCounts = null;
    });
  pendingCounts = { revision, promise };
  return promise;
}

function useDirectChildCounts(): Map<string, number> {
  const { revision } = useApp();
  const [counts, setCounts] = useState(() => (cachedRevision === revision ? cachedCounts : new Map<string, number>()));
  useEffect(() => {
    let cancel = false;
    loadChildCounts(revision)
      .then((next) => {
        if (!cancel) setCounts(next);
      })
      .catch(() => {
        if (!cancel) setCounts(new Map());
      });
    return () => {
      cancel = true;
    };
  }, [revision]);
  return counts;
}

export function TaskRow({
  task,
  lists,
  clock,
  selected,
  done,
  showDueDate,
  enter = false,
  onOpen,
  onToggle,
}: {
  task: Task;
  lists: TaskList[];
  clock: ClockPreference;
  selected: boolean;
  done: boolean;
  showDueDate?: boolean;
  enter?: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const list = lists.find((item) => item.id === task.listId);
  const listName = list?.name;
  const time = task.dueTime ? formatClock(task.dueTime, clock) : null;
  const due = showDueDate && task.dueOn ? formatShortDay(task.dueOn) : null;
  const childCount = useDirectChildCounts().get(task.id) ?? 0;
  const childLabel = childCount === 1 ? "1 subtask" : childCount > 1 ? `${childCount} subtasks` : null;
  return (
    <div
      className="task-row"
      data-selected={selected}
      data-done={done}
      data-enter={enter ? "true" : undefined}
      data-task-id={task.id}
      style={list ? ({ "--row-accent": list.color } as CSSProperties) : undefined}
    >
      {list ? <span className="row-accent" style={{ background: list.color }} aria-hidden /> : null}
      <button
        type="button"
        className="check press-sm"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={onToggle}
      >
        {done ? <Check size={14} strokeWidth={3} aria-hidden /> : null}
      </button>
      <PriorityMark priority={task.priority} />
      <button type="button" className="task-open" onClick={onOpen}>
        <span className="task-title">{task.title}</span>
        <span className="meta nums shrink-0">
          {[listName, due, time, childLabel].filter(Boolean).join(" · ")}
        </span>
      </button>
    </div>
  );
}

function PriorityMark({ priority }: { priority: Task["priority"] }) {
  if (priority === "none") return <span className="w-[10px] flex-none" />;
  const color = priority === "high" ? "var(--danger)" : priority === "medium" ? "var(--warning)" : "var(--ink-soft)";
  return <span className="priority-mark" style={{ background: color }} title={priority} />;
}
