import {
  checklistLines,
  formatClock,
  formatShortDay,
  movedIds,
  sortTasks,
  type ClockPreference,
  type Priority,
  type Task,
} from "@layp/shared";

export type BoardColumnModel = { id: string; name: string; tasks: Task[] };

export type BoardDrop =
  | { kind: "none" }
  | { kind: "complete"; orderedIds: string[] }
  | { kind: "reorder-done"; orderedIds: string[] }
  | { kind: "reopen"; sectionId: string; orderedIds: string[] }
  | { kind: "move"; sectionId: string; orderedIds: string[] | null };

export type SectionRef = { id: string; name: string; sortOrder: number };

/** Shown for an attachment row. The phone does not open the file. */
export const FILE_ON_COMPUTER = "File is on the computer.";

/** Same order as `firstSectionId`: sort order, then name. */
export function compareSections(a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

export function sectionDeletePlan(
  sections: SectionRef[],
  id: string,
): { error: "Last section stays." } | { targetId: string } {
  if (sections.length < 2) return { error: "Last section stays." };
  const remaining = sections.filter((section) => section.id !== id).sort(compareSections);
  const targetId = remaining[0]?.id;
  if (!targetId) return { error: "Last section stays." };
  return { targetId };
}

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

export function boardColumns(sections: { id: string; name: string; sortOrder: number }[], tasks: Task[]): BoardColumnModel[] {
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

export type CardFacts = {
  priority: Exclude<Priority, "none"> | null;
  due: string | null;
  time: string | null;
  checklist: { done: number; total: number } | null;
  tag: { name: string; extra: number } | null;
};

export function cardFacts(
  task: { notes: string; priority: Priority; dueOn: string | null; dueTime: string | null },
  tags: { name: string }[],
  clock: ClockPreference,
): CardFacts {
  const lines = checklistLines(task.notes);
  const done = lines.filter((line) => line.done).length;
  const first = tags[0];
  return {
    priority: task.priority === "none" ? null : task.priority,
    due: task.dueOn ? formatShortDay(task.dueOn) : null,
    time: task.dueTime ? formatClock(task.dueTime, clock) : null,
    checklist: lines.length > 0 ? { done, total: lines.length } : null,
    tag: first ? { name: first.name, extra: Math.max(0, tags.length - 1) } : null,
  };
}

/** Up or down inside a column. `undefined` means the card is already at that end. */
export function stepBeforeId(columnIds: string[], taskId: string, direction: -1 | 1): string | null | undefined {
  const next = movedIds(columnIds, taskId, direction);
  if (!next) return undefined;
  const index = next.indexOf(taskId);
  return next[index + 1] ?? null;
}

/** Same column keeps the index, so a null section writes `section_id` without a reorder. */
export function moveBeforeId(columnIds: string[], taskId: string, sameColumn: boolean): string | null {
  if (!sameColumn) return null;
  const index = columnIds.indexOf(taskId);
  if (index < 0) return null;
  return columnIds[index + 1] ?? null;
}

/** Open cards skip the column they already belong to. A null section still offers the first column. Done is only a target for an open card. */
export function moveDestinations(
  task: { sectionId: string | null; completedAt: string | null },
  columns: { id: string; name: string }[],
): { id: string; name: string }[] {
  const done = task.completedAt !== null;
  return columns.filter((column) => {
    if (column.id === "done") return !done;
    if (done) return true;
    return column.id !== task.sectionId;
  });
}
