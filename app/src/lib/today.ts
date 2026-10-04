export type DayTask = {
  id: string;
  pinned: boolean;
  startOn: string | null;
  dueOn: string | null;
  completedAt: string | null;
  deletedAt: string | null;
};

export type DayGroups<T extends DayTask> = {
  pinned: T[];
  overdue: T[];
  scheduled: T[];
  completed: T[];
};

export function groupTasksForDay<T extends DayTask>(tasks: T[], date: string, today: string): DayGroups<T> {
  const visible = tasks.filter((task) => task.deletedAt === null);
  const open = visible.filter((task) => task.completedAt === null);
  const pinned = date === today ? open.filter((task) => task.pinned) : [];
  const pinnedIds = new Set(pinned.map((task) => task.id));
  const overdue =
    date === today
      ? open.filter((task) => !pinnedIds.has(task.id) && task.dueOn !== null && task.dueOn < today)
      : [];
  const overdueIds = new Set(overdue.map((task) => task.id));
  const scheduled = open.filter(
    (task) =>
      !pinnedIds.has(task.id) &&
      !overdueIds.has(task.id) &&
      (task.dueOn === date || task.startOn === date),
  );
  const completed = visible.filter((task) => task.completedAt !== null && task.dueOn === date);
  return { pinned, overdue, scheduled, completed };
}
