import {
  cleanNotes,
  cleanTitle,
  parseRule,
  reconcileChecklistReminders,
  serializeRule,
  tagSchema,
  taskSchema,
  todayIso,
  type ClockPreference,
  type Priority,
  type RecurrenceRule,
  type Section,
  type Tag,
  type Task,
  type TaskList,
} from "@layp/shared";
import { randomUUID } from "../link/random";
import type { BoardDrop } from "./board";
import { completeOn } from "./complete";
import { withLock, withStamp } from "./lock";
import { firstSectionId, inboxList, readLists, readSections } from "./lists";
import { planQuickAdd } from "./quick";
import { readClock } from "./settings";
import type { Run, SqlStatement } from "./sql";
import { loadToday, type TodayTask } from "./today";

export type { TodayTask };

export type SaveResult<T> =
  | { status: "saved"; row: T }
  | { status: "conflict"; current: T | null }
  | { status: "error"; message: string };

export type NewTask = {
  title: string;
  notes?: string;
  listId: string;
  sectionId: string | null;
  dueOn?: string | null;
  dueTime?: string | null;
  priority?: Priority;
  important?: boolean;
  recurrence?: RecurrenceRule | null;
};

export type TaskPatch = {
  title?: string;
  notes?: string;
  listId?: string;
  sectionId?: string | null;
  priority?: Priority;
  dueOn?: string | null;
  dueTime?: string | null;
  recurrence?: RecurrenceRule | null;
};

const TASK_COLUMNS = `id, series_id, list_id, section_id, parent_id, title, notes, priority,
  important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
  estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at`;

export type TaskEditor = {
  task: Task | null;
  lists: TaskList[];
  sections: Section[];
  clock: "12" | "24";
};

export type InboxSnapshot = {
  tasks: Task[];
  lists: TaskList[];
  sections: Section[];
};

export type QuickSave =
  | { status: "empty" }
  | { status: "saved"; notice: string | null; row: Task }
  | { status: "error"; message: string };

export function tasksForDate(date: string, today: string): Promise<TodayTask[]> {
  return withLock((run) => loadToday(run, date, today));
}

export async function completeTask(id: string): Promise<"saved" | "none" | "error"> {
  try {
    return await withStamp((stamp, run) => completeOn(run, id, stamp, todayIso(), () => randomUUID()));
  } catch {
    return "error";
  }
}

export async function reopenTask(id: string): Promise<"saved" | "none" | "error"> {
  try {
    return await withStamp((stamp, run) => reopenOn(run, id, stamp));
  } catch {
    return "error";
  }
}

export function loadTaskEditor(id: string): Promise<TaskEditor> {
  return withLock((run) => loadTaskEditorOn(run, id));
}

export function loadInbox(): Promise<InboxSnapshot> {
  return withLock(loadInboxOn);
}

export async function createTask(input: NewTask): Promise<SaveResult<Task>> {
  const prepared = prepareNewTask(input);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  try {
    return await withStamp((stamp, run) => createOn(run, prepared.input, stamp, randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function addInboxTitle(title: string): Promise<SaveResult<Task>> {
  const cleaned = cleanTitle(title);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    return await withStamp(async (stamp, run) => {
      const lists = await readLists(run);
      const sections = await readSections(run);
      const inbox = inboxList(lists);
      if (!inbox) return { status: "error", message: "Not saved" };
      return createOn(
        run,
        {
          title: cleaned.title,
          notes: "",
          listId: inbox.id,
          sectionId: firstSectionId(sections, inbox.id),
          priority: "none",
          important: false,
        },
        stamp,
        randomUUID(),
      );
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function addQuick(text: string, now: { today: string; minutes: number | null }): Promise<QuickSave> {
  try {
    return await withStamp(async (stamp, run) => addQuickOn(run, text, now, stamp, () => randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function patchTask(task: Task, patch: TaskPatch, force = false): Promise<SaveResult<Task>> {
  const prepared = preparePatch(task, patch);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  try {
    return await withStamp((stamp, run) => patchOn(run, task, prepared.patch, stamp, force, () => randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function loadTaskEditorOn(run: Run, id: string): Promise<TaskEditor> {
  const task = await readTask(run, id);
  const lists = await readLists(run);
  const sections = await readSections(run);
  const clock = await readClock(run);
  return { task, lists, sections, clock };
}

export async function loadInboxOn(run: Run): Promise<InboxSnapshot> {
  const lists = await readLists(run);
  const sections = await readSections(run);
  const inbox = inboxList(lists);
  if (!inbox) return { tasks: [], lists, sections };
  const loaded = await run([
    {
      sql: `SELECT ${TASK_COLUMNS} FROM tasks
            WHERE list_id = $1 AND deleted_at IS NULL AND parent_id IS NULL
            ORDER BY sort_order ASC, created_at ASC`,
      values: [inbox.id],
    },
  ]);
  return { tasks: (loaded.batches[0]?.rows ?? []).map((row) => taskSchema.parse(row)), lists, sections };
}

/** Reopen clears this row only. A later occurrence stays. */
export async function reopenOn(run: Run, id: string, stamp: string): Promise<"saved" | "none"> {
  const saved = await run([
    {
      sql: `UPDATE tasks SET completed_at = NULL, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL`,
      values: [stamp, id],
    },
  ]);
  return (saved.batches[0]?.rowsAffected ?? 0) > 0 ? "saved" : "none";
}

export async function createOn(run: Run, input: NewTask, stamp: string, id: string): Promise<SaveResult<Task>> {
  const prepared = prepareNewTask(input);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const task = prepared.input;
  const max = await run([
    { sql: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM tasks WHERE list_id = $1`, values: [task.listId] },
  ]);
  const sortOrder = Number(max.batches[0]?.rows[0]?.max_sort ?? 0) + 1;
  const recurrenceJson = task.recurrence ? serializeRule(task.recurrence) : null;
  await run([
    {
      sql: `INSERT INTO tasks (
         id, series_id, list_id, section_id, parent_id, title, notes, priority,
         important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
         estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
       ) VALUES (
         $1, $1, $2, $3, NULL, $4, $5, $6,
         $7, 0, 0, NULL, $8, $9, NULL, $10,
         NULL, 0, $11, NULL, NULL, $12, $12
       )`,
      values: [
        id,
        task.listId,
        task.sectionId,
        task.title,
        task.notes ?? "",
        task.priority ?? "none",
        task.important ? 1 : 0,
        task.dueOn ?? null,
        task.dueTime ?? null,
        recurrenceJson,
        sortOrder,
        stamp,
      ],
    },
  ]);
  return {
    status: "saved",
    row: {
      id,
      seriesId: id,
      listId: task.listId,
      sectionId: task.sectionId,
      parentId: null,
      title: task.title,
      notes: task.notes ?? "",
      priority: task.priority ?? "none",
      important: task.important ?? false,
      urgent: false,
      pinned: false,
      startOn: null,
      dueOn: task.dueOn ?? null,
      dueTime: task.dueTime ?? null,
      durationMinutes: null,
      recurrenceJson,
      estimatedPomos: null,
      completedPomos: 0,
      sortOrder,
      completedAt: null,
      deletedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}

export async function addQuickOn(
  run: Run,
  text: string,
  now: { today: string; minutes: number | null },
  stamp: string,
  newId: () => string,
): Promise<QuickSave> {
  const lists = await readLists(run);
  const sections = await readSections(run);
  const plan = planQuickAdd(text, lists, sections, now);
  if (plan.status !== "ready") return plan;
  const saved = await createOn(run, plan.input, stamp, newId());
  if (saved.status !== "saved") return { status: "error", message: saved.status === "error" ? saved.message : "Not saved" };
  return { status: "saved", notice: plan.notice, row: saved.row };
}

export async function patchOn(
  run: Run,
  task: Task,
  patch: TaskPatch,
  stamp: string,
  force = false,
  newId: () => string = () => randomUUID(),
): Promise<SaveResult<Task>> {
  const prepared = preparePatch(task, patch);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const nextPatch = prepared.patch;
  const sets = ["updated_at = $1"];
  const values: (string | number | null)[] = [stamp];
  const add = (column: string, value: string | number | null) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (nextPatch.title !== undefined) add("title", nextPatch.title);
  if (nextPatch.notes !== undefined) add("notes", nextPatch.notes);
  if (nextPatch.listId !== undefined) add("list_id", nextPatch.listId);
  if (nextPatch.sectionId !== undefined) add("section_id", nextPatch.sectionId);
  if (nextPatch.priority !== undefined) add("priority", nextPatch.priority);
  if (nextPatch.dueOn !== undefined) add("due_on", nextPatch.dueOn);
  if (nextPatch.dueTime !== undefined) add("due_time", nextPatch.dueTime);
  let recurrenceJson: string | null | undefined;
  if (nextPatch.recurrence !== undefined) {
    recurrenceJson = nextPatch.recurrence === null ? null : serializeRule(nextPatch.recurrence);
    add("recurrence_json", recurrenceJson);
  }
  values.push(task.id);
  let sql = `UPDATE tasks SET ${sets.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL`;
  if (!force) {
    values.push(task.updatedAt);
    sql += ` AND updated_at = $${values.length}`;
  }
  const statements: SqlStatement[] = [{ sql, values }];
  if (nextPatch.dueOn !== undefined || nextPatch.dueTime !== undefined) {
    statements.push({
      sql: `UPDATE reminders SET fired_at = NULL, updated_at = $1
            WHERE task_id = $2
              AND EXISTS (SELECT 1 FROM tasks WHERE id = $2 AND deleted_at IS NULL AND updated_at = $1)`,
      values: [stamp, task.id],
    });
  }
  const saved = await run(statements);
  if ((saved.batches[0]?.rowsAffected ?? 0) === 0) {
    return { status: "conflict", current: await readTask(run, task.id) };
  }
  if (nextPatch.notes !== undefined && nextPatch.notes !== task.notes) {
    await syncChecklist(run, task.id, task.notes, nextPatch.notes, stamp, newId);
  }
  return {
    status: "saved",
    row: {
      ...task,
      ...(nextPatch.title !== undefined ? { title: nextPatch.title } : {}),
      ...(nextPatch.notes !== undefined ? { notes: nextPatch.notes } : {}),
      ...(nextPatch.listId !== undefined ? { listId: nextPatch.listId } : {}),
      ...(nextPatch.sectionId !== undefined ? { sectionId: nextPatch.sectionId } : {}),
      ...(nextPatch.priority !== undefined ? { priority: nextPatch.priority } : {}),
      ...(nextPatch.dueOn !== undefined ? { dueOn: nextPatch.dueOn } : {}),
      ...(nextPatch.dueTime !== undefined ? { dueTime: nextPatch.dueTime } : {}),
      ...(recurrenceJson !== undefined ? { recurrenceJson } : {}),
      updatedAt: stamp,
    },
  };
}

async function readTask(run: Run, id: string): Promise<Task | null> {
  const loaded = await run([{ sql: `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1`, values: [id] }]);
  const row = loaded.batches[0]?.rows[0];
  return row ? taskSchema.parse(row) : null;
}

async function syncChecklist(run: Run, taskId: string, previous: string, next: string, stamp: string, newId: () => string): Promise<void> {
  const loaded = await run([
    { sql: `SELECT id, line_text FROM checklist_reminders WHERE task_id = $1`, values: [taskId] },
  ]);
  const reminders = (loaded.batches[0]?.rows ?? []).flatMap((row) =>
    typeof row.id === "string" && typeof row.line_text === "string" ? [{ id: row.id, lineText: row.line_text }] : [],
  );
  const plan = reconcileChecklistReminders(previous, next, reminders);
  if (plan.updates.length === 0 && plan.removeIds.length === 0) return;
  const statements: SqlStatement[] = [];
  for (const update of plan.updates) {
    statements.push({
      sql: `UPDATE checklist_reminders SET line_text = $1, updated_at = $2 WHERE id = $3`,
      values: [update.lineText, stamp, update.id],
    });
  }
  for (const id of plan.removeIds) {
    statements.push({
      sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
      values: [newId(), "checklist_reminders", id, stamp],
    });
    statements.push({ sql: `DELETE FROM checklist_reminders WHERE id = $1`, values: [id] });
  }
  await run(statements);
}

function prepareNewTask(input: NewTask): { input: NewTask } | { error: string } {
  const title = cleanTitle(input.title);
  if ("error" in title) return { error: title.error };
  const notes = cleanNotes(input.notes ?? "");
  if ("error" in notes) return { error: notes.error };
  const recurrence = checkedRecurrence(input.recurrence);
  if ("error" in recurrence) return recurrence;
  return {
    input: {
      ...input,
      title: title.title,
      notes: notes.notes,
      recurrence: recurrence.recurrence,
    },
  };
}

function preparePatch(task: Task, patch: TaskPatch): { patch: TaskPatch } | { error: string } {
  let next = patch;
  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if ("error" in title) return { error: title.error };
    next = { ...next, title: title.title };
  }
  if (patch.notes !== undefined) {
    const notes = cleanNotes(patch.notes);
    if ("error" in notes) return { error: notes.error };
    next = { ...next, notes: notes.notes };
  }
  if (patch.recurrence !== undefined) {
    const recurrence = checkedRecurrence(patch.recurrence);
    if ("error" in recurrence) return recurrence;
    next = { ...next, recurrence: recurrence.recurrence };
  }
  if (patch.priority !== undefined && !["none", "low", "medium", "high"].includes(patch.priority)) {
    return { error: "Not saved" };
  }
  void task;
  return { patch: next };
}

function checkedRecurrence(value: RecurrenceRule | null | undefined): { recurrence: RecurrenceRule | null | undefined } | { error: string } {
  if (value === undefined) return { recurrence: undefined };
  if (value === null) return { recurrence: null };
  const checked = parseRule(serializeRule(value));
  if (!checked) return { error: "Not saved" };
  return { recurrence: checked };
}

export type BoardFile = { id: string; taskId: string; fileName: string };
export type BoardLink = { taskId: string; tagId: string };

export type BoardSnapshot = {
  lists: TaskList[];
  list: TaskList | null;
  sections: Section[];
  tasks: Task[];
  tags: Tag[];
  links: BoardLink[];
  files: BoardFile[];
  clock: ClockPreference;
};

export function loadBoard(listId: string | null): Promise<BoardSnapshot> {
  return withLock((run) => loadBoardOn(run, listId));
}

export async function loadBoardOn(run: Run, preferredListId: string | null): Promise<BoardSnapshot> {
  const lists = await readLists(run);
  const list = lists.find((item) => item.id === preferredListId) ?? inboxList(lists) ?? lists[0] ?? null;
  const clock = await readClock(run);
  if (!list) return { lists, list: null, sections: [], tasks: [], tags: [], links: [], files: [], clock };
  const sections = (await readSections(run)).filter((section) => section.listId === list.id);
  const loaded = await run([
    {
      sql: `SELECT ${TASK_COLUMNS} FROM tasks
            WHERE list_id = $1 AND deleted_at IS NULL AND parent_id IS NULL
            ORDER BY sort_order ASC, created_at ASC`,
      values: [list.id],
    },
    { sql: `SELECT id, name, color, created_at, updated_at FROM tags`, values: [] },
    {
      sql: `SELECT task_tags.task_id AS task_id, task_tags.tag_id AS tag_id
            FROM task_tags
            JOIN tasks ON tasks.id = task_tags.task_id
            WHERE tasks.list_id = $1 AND tasks.deleted_at IS NULL AND tasks.parent_id IS NULL`,
      values: [list.id],
    },
    {
      sql: `SELECT attachments.id AS id, attachments.task_id AS task_id, attachments.file_name AS file_name
            FROM attachments
            JOIN tasks ON tasks.id = attachments.task_id
            WHERE tasks.list_id = $1 AND tasks.deleted_at IS NULL AND tasks.parent_id IS NULL
            ORDER BY attachments.created_at ASC, attachments.id ASC`,
      values: [list.id],
    },
  ]);
  return {
    lists,
    list,
    sections,
    tasks: (loaded.batches[0]?.rows ?? []).map((row) => taskSchema.parse(row)),
    tags: (loaded.batches[1]?.rows ?? []).map((row) => tagSchema.parse(row)),
    links: (loaded.batches[2]?.rows ?? []).flatMap((row) =>
      typeof row.task_id === "string" && typeof row.tag_id === "string" ? [{ taskId: row.task_id, tagId: row.tag_id }] : [],
    ),
    files: (loaded.batches[3]?.rows ?? []).flatMap((row) =>
      typeof row.id === "string" && typeof row.task_id === "string" && typeof row.file_name === "string"
        ? [{ id: row.id, taskId: row.task_id, fileName: row.file_name }]
        : [],
    ),
    clock,
  };
}

/** Section change and destination order. Does not complete or reopen. A null `orderedIds` writes `section_id` only. */
export async function moveOnBoard(
  run: Run,
  taskId: string,
  sectionId: string,
  orderedIds: string[] | null,
  stamp: string,
): Promise<void> {
  if (!orderedIds) {
    await run([
      {
        sql: `UPDATE tasks SET section_id = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL`,
        values: [sectionId, stamp, taskId],
      },
    ]);
    return;
  }
  await run(
    orderedIds.map((id, index) =>
      id === taskId
        ? {
            sql: `UPDATE tasks SET section_id = $1, sort_order = $2, updated_at = $3 WHERE id = $4 AND deleted_at IS NULL`,
            values: [sectionId, index, stamp, id],
          }
        : {
            sql: `UPDATE tasks SET sort_order = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL`,
            values: [index, stamp, id],
          },
    ),
  );
}

export async function rewriteOrderOn(run: Run, ids: string[], stamp: string): Promise<void> {
  if (ids.length === 0) return;
  await run(
    ids.map((id, index) => ({
      sql: `UPDATE tasks SET sort_order = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL`,
      values: [index, stamp, id],
    })),
  );
}

export async function applyBoardDropOn(
  run: Run,
  task: Task,
  plan: BoardDrop,
  stamp: string,
  today: string,
  newId: () => string,
): Promise<"saved" | "none" | "error"> {
  if (plan.kind === "none") return "none";
  if (plan.kind === "move") {
    await moveOnBoard(run, task.id, plan.sectionId, plan.orderedIds, stamp);
    return "saved";
  }
  if (plan.kind === "reorder-done") {
    await rewriteOrderOn(run, plan.orderedIds, stamp);
    return "saved";
  }
  if (plan.kind === "complete") {
    const saved = await completeOn(run, task.id, stamp, today, newId);
    if (saved !== "saved") return saved;
    await rewriteOrderOn(run, plan.orderedIds, stamp);
    return "saved";
  }
  const saved = await reopenOn(run, task.id, stamp);
  if (saved !== "saved") return "none";
  const current = await readTask(run, task.id);
  if (!current) return "none";
  const patched = await patchOn(run, current, { sectionId: plan.sectionId }, stamp, true);
  if (patched.status !== "saved") return "error";
  await rewriteOrderOn(run, plan.orderedIds, stamp);
  return "saved";
}

export async function applyBoardDrop(
  task: Task,
  plan: BoardDrop,
): Promise<{ status: "saved" } | { status: "none" } | { status: "error"; message: string }> {
  if (plan.kind === "none") return { status: "none" };
  try {
    const result = await withStamp((stamp, run) => applyBoardDropOn(run, task, plan, stamp, todayIso(), () => randomUUID()));
    if (result === "saved") return { status: "saved" };
    if (result === "none") return { status: "none" };
    return { status: "error", message: "Not saved" };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}
