import { Temporal } from "temporal-polyfill";
import type { WeekStart } from "./dates";
import { subtaskTree, type SubtaskNode } from "./subtasks";

export const timelineRanges = ["2w", "6w", "3m"] as const;
export type TimelineRange = (typeof timelineRanges)[number];

export type TimelineTask = {
  id: string;
  parentId: string | null;
  listId: string;
  title: string;
  startOn: string | null;
  dueOn: string | null;
  sortOrder: number;
};

export type TimelineRow<T extends TimelineTask = TimelineTask> = {
  task: T;
  depth: number;
  bar: boolean;
};

export function timelineDays(today: string, range: TimelineRange, weekStart: WeekStart): string[] {
  const date = Temporal.PlainDate.from(today);
  const offset = weekStart === "monday" ? date.dayOfWeek - 1 : date.dayOfWeek % 7;
  const start = date.subtract({ days: offset });
  const end = range === "3m" ? start.add({ months: 3 }) : start.add({ days: range === "2w" ? 14 : 42 });
  const count = start.until(end, { largestUnit: "days" }).days;
  return Array.from({ length: count }, (_, index) => start.add({ days: index }).toString());
}

function overlaps(task: TimelineTask, first: string, last: string): boolean {
  const start = task.startOn && task.dueOn ? task.startOn : (task.dueOn ?? task.startOn);
  if (!start) return false;
  const end = task.startOn && task.dueOn ? task.dueOn : start;
  const lo = start < end ? start : end;
  const hi = end < start ? start : end;
  return lo <= last && hi >= first;
}

export function timelineGroups<T extends TimelineTask>(
  tasks: T[],
  listOrder: string[],
  first: string,
  last: string,
): { listId: string; rows: { task: T; depth: number; bar: boolean }[] }[] {
  const byId = new Set(tasks.map((task) => task.id));
  const roots = tasks
    .filter((task) => !task.parentId || !byId.has(task.parentId))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const rowsByList = new Map<string, TimelineRow<T>[]>();

  function pushBranch(node: SubtaskNode<T>, depth: number, into: TimelineRow<T>[]) {
    const showSelf = overlaps(node.task, first, last);
    const childRows: TimelineRow<T>[] = [];
    for (const child of node.children) pushBranch(child, depth + 1, childRows);
    if (!showSelf && childRows.length === 0) return;
    if (showSelf || depth === 0) into.push({ task: node.task, depth, bar: showSelf });
    into.push(...childRows);
  }

  for (const root of roots) {
    const rows = rowsByList.get(root.listId) ?? [];
    const before = rows.length;
    pushBranch({ task: root, children: subtaskTree(tasks, root.id) }, 0, rows);
    if (rows.length !== before) rowsByList.set(root.listId, rows);
  }

  const seen = new Set<string>();
  const ordered = [...listOrder.filter((id) => rowsByList.has(id)), ...[...rowsByList.keys()].filter((id) => !listOrder.includes(id))];
  return ordered
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((listId) => ({ listId, rows: rowsByList.get(listId) ?? [] }));
}
