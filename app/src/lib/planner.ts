import { Temporal } from "temporal-polyfill";
import { addDays } from "./dates";
import type { Priority } from "../db/types";

export type TaskSort = "manual" | "due" | "priority" | "created";

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

export type SortableTask = {
  sortOrder: number;
  dueOn: string | null;
  dueTime: string | null;
  priority: Priority;
  createdAt: string;
};

export function sortTasks<T extends SortableTask>(tasks: T[], mode: TaskSort): T[] {
  const copy = [...tasks];
  if (mode === "due") {
    copy.sort((a, b) => (a.dueOn ?? "9999-99-99").localeCompare(b.dueOn ?? "9999-99-99") || (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") || a.sortOrder - b.sortOrder);
  } else if (mode === "priority") {
    copy.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sortOrder - b.sortOrder);
  } else if (mode === "created") {
    copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } else {
    copy.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  }
  return copy;
}

export function movedIds(ids: string[], id: string, direction: -1 | 1): string[] | null {
  const index = ids.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= ids.length) return null;
  const copy = [...ids];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

export type FilterRule = {
  listId: string | null;
  listNot: boolean;
  tagId: string | null;
  priority: Priority | null;
  due: "any" | "overdue" | "today" | "next7" | "none" | "range";
  dueFrom: string | null;
  dueTo: string | null;
  completed: "any" | "open" | "completed";
  important: boolean | null;
  urgent: boolean | null;
};

export const emptyRule = (): FilterRule => ({
  listId: null,
  listNot: false,
  tagId: null,
  priority: null,
  due: "any",
  dueFrom: null,
  dueTo: null,
  completed: "open",
  important: null,
  urgent: null,
});

export type FilterTask = {
  listId: string;
  priority: Priority;
  dueOn: string | null;
  completedAt: string | null;
  important: boolean;
  urgent: boolean;
  tagIds: string[];
};

export function matchFilter(task: FilterTask, rule: FilterRule, today: string): boolean {
  if (rule.listId) {
    const same = task.listId === rule.listId;
    if (rule.listNot ? same : !same) return false;
  }
  if (rule.tagId && !task.tagIds.includes(rule.tagId)) return false;
  if (rule.priority && task.priority !== rule.priority) return false;
  if (rule.completed === "open" && task.completedAt) return false;
  if (rule.completed === "completed" && !task.completedAt) return false;
  if (rule.important !== null && task.important !== rule.important) return false;
  if (rule.urgent !== null && task.urgent !== rule.urgent) return false;
  if (rule.due === "none") return task.dueOn === null;
  if (rule.due === "overdue") return task.dueOn !== null && task.dueOn < today && task.completedAt === null;
  if (rule.due === "today") return task.dueOn === today;
  if (rule.due === "next7") {
    if (!task.dueOn) return false;
    return task.dueOn >= today && task.dueOn <= addDays(today, 6);
  }
  if (rule.due === "range") {
    if (!task.dueOn) return false;
    if (rule.dueFrom && task.dueOn < rule.dueFrom) return false;
    if (rule.dueTo && task.dueOn > rule.dueTo) return false;
  }
  return true;
}

export function countdownLabel(target: string, today: string): string {
  const days = Temporal.PlainDate.from(today).until(Temporal.PlainDate.from(target), { largestUnit: "days" }).days;
  if (days > 1) return `${days} days`;
  if (days === 1) return "1 day";
  if (days === 0) return "Today";
  if (days === -1) return "1 day ago";
  return `${-days} days ago`;
}

export function describeEdit(changed: {
  title?: boolean;
  dates?: boolean;
  list?: boolean;
  priority?: boolean;
}): string | null {
  const parts = [
    changed.title ? "Title" : null,
    changed.dates ? "Dates" : null,
    changed.list ? "List" : null,
    changed.priority ? "Priority" : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1) return `${parts[0]} changed`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]} changed`;
}
