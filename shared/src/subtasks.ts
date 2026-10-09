export type SubtaskLink = {
  id: string;
  parentId: string | null;
};

export type SubtaskNode<T extends SubtaskLink = SubtaskLink> = {
  task: T;
  children: SubtaskNode<T>[];
};

const MAX_DEPTH = 8;

export function subtaskTree<T extends SubtaskLink>(tasks: T[], rootId: string): SubtaskNode<T>[] {
  const byParent = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.parentId || task.parentId === task.id) continue;
    const siblings = byParent.get(task.parentId);
    if (siblings) siblings.push(task);
    else byParent.set(task.parentId, [task]);
  }
  const placed = new Set<string>();

  function walk(parentId: string, ancestors: Set<string>, depth: number): SubtaskNode<T>[] {
    if (depth >= MAX_DEPTH) return [];
    const nodes: SubtaskNode<T>[] = [];
    for (const task of byParent.get(parentId) ?? []) {
      if (ancestors.has(task.id) || placed.has(task.id)) continue;
      placed.add(task.id);
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(task.id);
      nodes.push({ task, children: walk(task.id, nextAncestors, depth + 1) });
    }
    return nodes;
  }

  return walk(rootId, new Set([rootId]), 0);
}

export function parentCreatesCycle(tasks: SubtaskLink[], taskId: string, parentId: string | null): boolean {
  if (!parentId) return false;
  if (parentId === taskId) return true;
  const parentOf = new Map(tasks.map((task) => [task.id, task.parentId]));
  const childrenOf = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parentId || task.parentId === task.id) continue;
    const children = childrenOf.get(task.parentId);
    if (children) children.push(task.id);
    else childrenOf.set(task.parentId, [task.id]);
  }
  const seen = new Set<string>();
  const stack = [...(childrenOf.get(taskId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    if (id === parentId) return true;
    seen.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  const walked = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === taskId) return true;
    if (walked.has(cursor)) break;
    walked.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
