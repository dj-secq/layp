import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { formatClock, formatShortDay, type Section, type Task } from "@layp/shared";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("board tests drive SQL through node:sqlite");
  },
}));

import {
  boardColumns,
  boardDrop,
  cardFacts,
  FILE_ON_COMPUTER,
  moveBeforeId,
  moveDestinations,
  sectionDeletePlan,
  stepBeforeId,
  tagsOnCard,
} from "./board";
import { createSectionOn, deleteSectionOn, renameSectionOn, reorderSectionsOn } from "./lists";
import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
import type { Run } from "./sql";
import { applyBoardDropOn, loadBoardOn, moveOnBoard } from "./tasks";

const stamp = "2026-10-08T12:00:00.000Z";
const laterStamp = "2026-10-08T13:00:00.000Z";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    seriesId: "s1",
    listId: "list",
    sectionId: "alpha",
    parentId: null,
    title: "Milk",
    notes: "",
    priority: "none",
    important: false,
    urgent: false,
    pinned: false,
    startOn: null,
    dueOn: null,
    dueTime: null,
    durationMinutes: null,
    recurrenceJson: null,
    estimatedPomos: null,
    completedPomos: 0,
    sortOrder: 0,
    completedAt: null,
    deletedAt: null,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
    ...overrides,
  };
}

const alpha = { id: "alpha", name: "Alpha", sortOrder: 0 };
const zebra = { id: "zebra", name: "Zebra", sortOrder: 0 };
const middle = { id: "middle", name: "Middle", sortOrder: 1 };

it("sorts columns by sort order then name and parks a null section in the first", () => {
  const columns = boardColumns(
    [zebra, middle, alpha],
    [
      task({ id: "loose", sectionId: null, title: "Loose", sortOrder: 2 }),
      task({ id: "named", sectionId: "zebra", title: "Named", sortOrder: 0 }),
      task({ id: "later", sectionId: "alpha", title: "Later", sortOrder: 1, createdAt: "2026-10-09T00:00:00.000Z" }),
      task({ id: "sooner", sectionId: "alpha", title: "Sooner", sortOrder: 1, createdAt: "2026-10-01T00:00:00.000Z" }),
      task({ id: "finished", sectionId: "alpha", completedAt: "2026-10-08T01:00:00.000Z" }),
    ],
  );
  expect(columns.map((column) => column.name)).toEqual(["Alpha", "Zebra", "Middle", "Done"]);
  expect(columns[0]?.tasks.map((item) => item.id)).toEqual(["sooner", "later", "loose"]);
  expect(columns[1]?.tasks.map((item) => item.id)).toEqual(["named"]);
  expect(columns[3]?.tasks.map((item) => item.id)).toEqual(["finished"]);
});

it("leaves a card where it is when the index and section already match", () => {
  const card = task({ id: "a", sectionId: "alpha" });
  expect(boardDrop(card, "alpha", "b", ["a", "b"])).toEqual({ kind: "none" });
  expect(boardDrop(card, "alpha", "a", ["a", "b"])).toEqual({ kind: "none" });
});

it("writes the section when a null card stays at the same index", () => {
  const card = task({ id: "loose", sectionId: null });
  const ids = ["sooner", "loose", "later"];
  const beforeId = moveBeforeId(ids, "loose", true);
  expect(beforeId).toBe("later");
  expect(boardDrop(card, "alpha", beforeId, ids)).toEqual({ kind: "move", sectionId: "alpha", orderedIds: null });
  expect(boardDrop(card, "zebra", moveBeforeId(["a"], "loose", false), ["a"])).toEqual({
    kind: "move",
    sectionId: "zebra",
    orderedIds: ["a", "loose"],
  });
});

it("inserts before the card under the pointer and appends on the column", () => {
  const card = task({ id: "c", sectionId: "alpha" });
  expect(boardDrop(card, "alpha", "a", ["a", "b", "c"])).toEqual({
    kind: "move",
    sectionId: "alpha",
    orderedIds: ["c", "a", "b"],
  });
  expect(boardDrop(card, "zebra", null, ["a", "b"])).toEqual({
    kind: "move",
    sectionId: "zebra",
    orderedIds: ["a", "b", "c"],
  });
});

it("completes an open drop on Done and only reorders a card that is already done", () => {
  const open = task({ id: "c", sectionId: "alpha", completedAt: null });
  expect(boardDrop(open, "done", "d1", ["d1", "d2"])).toEqual({ kind: "complete", orderedIds: ["c", "d1", "d2"] });
  const done = task({ id: "d2", sectionId: "alpha", completedAt: "2026-10-08T01:00:00.000Z" });
  expect(boardDrop(done, "done", "d1", ["d1", "d2"])).toEqual({ kind: "reorder-done", orderedIds: ["d2", "d1"] });
  expect(boardDrop(done, "done", null, ["d1", "d2"])).toEqual({ kind: "none" });
});

it("reopens a completed card onto the destination section", () => {
  const done = task({ id: "d", sectionId: "alpha", completedAt: "2026-10-08T01:00:00.000Z" });
  expect(boardDrop(done, "zebra", "b", ["a", "b"])).toEqual({
    kind: "reopen",
    sectionId: "zebra",
    orderedIds: ["a", "d", "b"],
  });
});

it("picks the first tag name by localeCompare", () => {
  const tags = tagsOnCard(
    "t1",
    [
      { taskId: "t1", tagId: "work" },
      { taskId: "t1", tagId: "home" },
      { taskId: "other", tagId: "home" },
    ],
    [
      { id: "work", name: "Work", color: "#111111" },
      { id: "home", name: "Home", color: "#222222" },
    ],
  );
  expect(tags.map((tag) => tag.name)).toEqual(["Home", "Work"]);
});

it("keeps the last section and picks the next first by sort order then name", () => {
  expect(sectionDeletePlan([{ id: "only", name: "Open", sortOrder: 0 }], "only")).toEqual({ error: "Last section stays." });
  const sections = [
    { id: "second", name: "Beta", sortOrder: 2 },
    { id: "first", name: "Alpha", sortOrder: 1 },
    { id: "third", name: "Gamma", sortOrder: 3 },
  ];
  expect(sectionDeletePlan(sections, "first")).toEqual({ targetId: "second" });
  expect(sectionDeletePlan(sections, "second")).toEqual({ targetId: "first" });
  expect(sectionDeletePlan([alpha, zebra, middle], "middle")).toEqual({ targetId: "alpha" });
});

it("maps an up or down step to the card now underneath", () => {
  expect(stepBeforeId(["a", "b", "c"], "b", -1)).toBe("a");
  expect(stepBeforeId(["a", "b", "c"], "b", 1)).toBe(null);
  expect(stepBeforeId(["a", "b", "c"], "a", -1)).toBeUndefined();
  expect(stepBeforeId(["a", "b", "c"], "c", 1)).toBeUndefined();
});

it("offers the first column to a null section and hides Done from a finished card", () => {
  const columns = [
    { id: "alpha", name: "Alpha" },
    { id: "zebra", name: "Zebra" },
    { id: "done", name: "Done" },
  ];
  expect(moveDestinations({ sectionId: "alpha", completedAt: null }, columns).map((column) => column.id)).toEqual(["zebra", "done"]);
  expect(moveDestinations({ sectionId: null, completedAt: null }, columns).map((column) => column.id)).toEqual(["alpha", "zebra", "done"]);
  expect(moveDestinations({ sectionId: "alpha", completedAt: stamp }, columns).map((column) => column.id)).toEqual(["alpha", "zebra"]);
});

it("shows priority, the checklist count, and the first tag without a locale-locked date", () => {
  const facts = cardFacts(
    {
      notes: "[ ] milk\n[x] eggs\nplain",
      priority: "high",
      dueOn: "2026-10-08",
      dueTime: "18:00",
    },
    [
      { name: "Home" },
      { name: "Work" },
    ],
    "12",
  );
  expect(facts.priority).toBe("high");
  expect(facts.due).toBe(formatShortDay("2026-10-08"));
  expect(facts.time).toBe(formatClock("18:00", "12"));
  expect(facts.checklist).toEqual({ done: 1, total: 2 });
  expect(facts.tag).toEqual({ name: "Home", extra: 1 });
  expect(cardFacts({ notes: "", priority: "none", dueOn: null, dueTime: null }, [], "12")).toEqual({
    priority: null,
    due: null,
    time: null,
    checklist: null,
    tag: null,
  });
  expect(FILE_ON_COMPUTER).toBe("File is on the computer.");
});

async function prepare(): Promise<DatabaseSync> {
  const db = openMemory();
  const files = ["001_schema.sql", "002_checklist_reminders.sql", "003_attachments.sql", "004_fts.sql", "005_phone.sql"].map(
    (name, index) => ({
      version: index + 1,
      sql: readFileSync(fileURLToPath(new URL(`../../../app/src-tauri/migrations/${name}`, import.meta.url)), "utf8"),
    }),
  );
  await applyMigrations(
    {
      exec: async (sql) => {
        db.exec(sql);
      },
      all: async (sql, values) => {
        const statement = db.prepare(sql);
        return (values?.length ? statement.all(named(values)) : statement.all()) as Record<string, unknown>[];
      },
      run: async (sql, values) => {
        const statement = db.prepare(sql);
        if (values?.length) statement.run(named(values));
        else statement.run();
      },
      transaction: async (body) => {
        db.exec("BEGIN");
        try {
          await body();
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      },
    },
    files,
  );
  return db;
}

function tracing(db: DatabaseSync, clock: string = stamp): Run {
  return async (statements) => nodeRun(db, () => clock)(statements);
}

function insertList(db: DatabaseSync, id: string, name: string): void {
  db.prepare(
    `INSERT INTO lists (id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at)
     VALUES ($id, NULL, $name, '#ffdc58', 1, NULL, 0, $created, $created)`,
  ).run({ $id: id, $name: name, $created: stamp });
}

function insertSection(db: DatabaseSync, id: string, listId: string, name: string, sortOrder: number): void {
  db.prepare(`INSERT INTO sections (id, list_id, name, sort_order, updated_at) VALUES ($id, $list, $name, $sort, $created)`).run({
    $id: id,
    $list: listId,
    $name: name,
    $sort: sortOrder,
    $created: stamp,
  });
}

function insertTask(
  db: DatabaseSync,
  id: string,
  fields: {
    list?: string;
    section?: string | null;
    parent?: string | null;
    sort?: number;
    completed?: string | null;
    deleted?: string | null;
    title?: string;
    created?: string;
  } = {},
): void {
  db.prepare(
    `INSERT INTO tasks (
      id, series_id, list_id, section_id, parent_id, title, notes, priority,
      important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
      estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
    ) VALUES (
      $id, $id, $list, $section, $parent, $title, '', 'none',
      0, 0, 0, NULL, NULL, NULL, NULL, NULL,
      NULL, 0, $sort, $completed, $deleted, $created, $created
    )`,
  ).run({
    $id: id,
    $list: fields.list ?? "inbox",
    $section: fields.section === undefined ? "inbox-open" : fields.section,
    $parent: fields.parent ?? null,
    $title: fields.title ?? id,
    $sort: fields.sort ?? 0,
    $completed: fields.completed ?? null,
    $deleted: fields.deleted ?? null,
    $created: fields.created ?? stamp,
  });
}

it("writes a null section on move and does not reorder when the index stays", async () => {
  const db = await prepare();
  insertTask(db, "loose", { section: null, sort: 4 });
  insertTask(db, "kept", { sort: 1 });
  await moveOnBoard(tracing(db), "loose", "inbox-open", null, laterStamp);
  const loose = db.prepare(`SELECT section_id, sort_order, updated_at FROM tasks WHERE id = 'loose'`).get() as {
    section_id: string;
    sort_order: number;
    updated_at: string;
  };
  const kept = db.prepare(`SELECT section_id, sort_order, updated_at FROM tasks WHERE id = 'kept'`).get() as {
    section_id: string;
    sort_order: number;
    updated_at: string;
  };
  expect(loose).toEqual({ section_id: "inbox-open", sort_order: 4, updated_at: laterStamp });
  expect(kept).toEqual({ section_id: "inbox-open", sort_order: 1, updated_at: stamp });
});

it("completes onto Done, reopens onto a section, and reorders a finished card", async () => {
  const db = await prepare();
  insertList(db, "board", "Board");
  insertSection(db, "alpha", "board", "Alpha", 0);
  insertSection(db, "zebra", "board", "Zebra", 1);
  insertTask(db, "c", { list: "board", section: "alpha", sort: 5 });
  insertTask(db, "d1", { list: "board", section: "alpha", sort: 0, completed: stamp });
  const completed = await applyBoardDropOn(
    tracing(db, laterStamp),
    task({ id: "c", listId: "board", sectionId: "alpha" }),
    { kind: "complete", orderedIds: ["c", "d1"] },
    laterStamp,
    "2026-10-08",
    () => "unused",
  );
  expect(completed).toBe("saved");
  expect(db.prepare(`SELECT completed_at, sort_order FROM tasks WHERE id = 'c'`).get()).toEqual({
    completed_at: laterStamp,
    sort_order: 0,
  });
  expect(db.prepare(`SELECT completed_at, sort_order FROM tasks WHERE id = 'd1'`).get()).toEqual({
    completed_at: stamp,
    sort_order: 1,
  });

  insertTask(db, "a", { list: "board", section: "zebra", sort: 0 });
  const reopened = await applyBoardDropOn(
    tracing(db, laterStamp),
    task({ id: "d1", listId: "board", sectionId: "alpha", completedAt: stamp }),
    { kind: "reopen", sectionId: "zebra", orderedIds: ["d1", "a"] },
    laterStamp,
    "2026-10-08",
    () => "unused",
  );
  expect(reopened).toBe("saved");
  expect(db.prepare(`SELECT section_id, completed_at, sort_order FROM tasks WHERE id = 'd1'`).get()).toEqual({
    section_id: "zebra",
    completed_at: null,
    sort_order: 0,
  });
  expect(db.prepare(`SELECT section_id, sort_order FROM tasks WHERE id = 'a'`).get()).toEqual({
    section_id: "zebra",
    sort_order: 1,
  });

  insertTask(db, "d2", { list: "board", section: "alpha", sort: 3, completed: stamp });
  const swapped = await applyBoardDropOn(
    tracing(db, laterStamp),
    task({ id: "d2", completedAt: stamp }),
    { kind: "reorder-done", orderedIds: ["d2", "c"] },
    laterStamp,
    "2026-10-08",
    () => "unused",
  );
  expect(swapped).toBe("saved");
  expect(db.prepare(`SELECT sort_order, completed_at FROM tasks WHERE id = 'd2'`).get()).toEqual({
    sort_order: 0,
    completed_at: stamp,
  });
  expect(db.prepare(`SELECT sort_order, completed_at FROM tasks WHERE id = 'c'`).get()).toEqual({
    sort_order: 1,
    completed_at: laterStamp,
  });
});

it("refuses the last section and moves every task, including completed and trashed, to the first by name", async () => {
  const db = await prepare();
  insertTask(db, "stays", { section: "inbox-open" });
  const refused = await deleteSectionOn(tracing(db), "inbox-open", "inbox", laterStamp, () => "del-no");
  expect(refused).toEqual({ status: "error", message: "Last section stays." });
  expect(db.prepare(`SELECT COUNT(*) AS n FROM sections WHERE id = 'inbox-open'`).get()).toEqual({ n: 1 });
  expect(db.prepare(`SELECT COUNT(*) AS n FROM deletions`).get()).toEqual({ n: 0 });
  expect(db.prepare(`SELECT section_id, updated_at FROM tasks WHERE id = 'stays'`).get()).toEqual({
    section_id: "inbox-open",
    updated_at: stamp,
  });

  insertList(db, "board", "Board");
  insertSection(db, "alpha", "board", "Alpha", 0);
  insertSection(db, "zebra", "board", "Zebra", 0);
  insertSection(db, "middle", "board", "Middle", 1);
  insertTask(db, "open-1", { list: "board", section: "middle", sort: 1 });
  insertTask(db, "child-1", { list: "board", section: "middle", parent: "open-1", sort: 2 });
  insertTask(db, "done-1", { list: "board", section: "middle", completed: stamp, sort: 3 });
  insertTask(db, "trash-1", { list: "board", section: "middle", deleted: stamp, sort: 4 });
  insertTask(db, "other", { list: "board", section: "zebra", sort: 0 });
  const removed = await deleteSectionOn(tracing(db), "middle", "board", laterStamp, () => "del-1");
  expect(removed).toEqual({ status: "saved", row: { id: "middle" } });
  const moved = db.prepare(`SELECT id, section_id, updated_at FROM tasks WHERE list_id = 'board' ORDER BY id`).all() as {
    id: string;
    section_id: string;
    updated_at: string;
  }[];
  expect(moved).toEqual([
    { id: "child-1", section_id: "alpha", updated_at: laterStamp },
    { id: "done-1", section_id: "alpha", updated_at: laterStamp },
    { id: "open-1", section_id: "alpha", updated_at: laterStamp },
    { id: "other", section_id: "zebra", updated_at: stamp },
    { id: "trash-1", section_id: "alpha", updated_at: laterStamp },
  ]);
  expect(db.prepare(`SELECT id, entity, entity_id, deleted_at FROM deletions`).get()).toEqual({
    id: "del-1",
    entity: "sections",
    entity_id: "middle",
    deleted_at: laterStamp,
  });
  expect(db.prepare(`SELECT COUNT(*) AS n FROM sections WHERE id = 'middle'`).get()).toEqual({ n: 0 });
  const missing = await deleteSectionOn(tracing(db), "missing", "board", laterStamp, () => "del-2");
  expect(missing).toEqual({ status: "error", message: "Not saved" });
  expect(db.prepare(`SELECT COUNT(*) AS n FROM deletions`).get()).toEqual({ n: 1 });
});

it("stamps a new section, a rename, and a reorder", async () => {
  const db = await prepare();
  const run = tracing(db);
  const blank = await createSectionOn(run, "inbox", "   ", stamp, "nope");
  expect(blank).toEqual({ status: "error", message: "Add a name." });
  const long = await createSectionOn(run, "inbox", "a".repeat(81), stamp, "nope");
  expect(long).toEqual({ status: "error", message: "Names can be 80 characters." });
  expect(db.prepare(`SELECT COUNT(*) AS n FROM sections WHERE list_id = 'inbox'`).get()).toEqual({ n: 1 });
  const created = await createSectionOn(run, "inbox", "  Later  ", laterStamp, "later");
  expect(created).toEqual({
    status: "saved",
    row: { id: "later", listId: "inbox", name: "Later", sortOrder: 1, updatedAt: laterStamp },
  });
  const saved = db.prepare(`SELECT name, sort_order, updated_at FROM sections WHERE id = 'later'`).get();
  expect(saved).toEqual({ name: "Later", sort_order: 1, updated_at: laterStamp });
  const current: Section = {
    id: "inbox-open",
    listId: "inbox",
    name: "Open",
    sortOrder: 0,
    updatedAt: "2026-10-08T00:00:00.000Z",
  };
  const wrongList = await renameSectionOn(run, { ...current, listId: "other" }, "Nope", laterStamp);
  expect(wrongList).toEqual({ status: "error", message: "Not saved" });
  const renamed = await renameSectionOn(run, current, "Now", laterStamp);
  expect(renamed.status).toBe("saved");
  expect(db.prepare(`SELECT name, updated_at FROM sections WHERE id = 'inbox-open'`).get()).toEqual({
    name: "Now",
    updated_at: laterStamp,
  });
  await reorderSectionsOn(run, ["later", "inbox-open"], laterStamp);
  expect(db.prepare(`SELECT id, sort_order, updated_at FROM sections WHERE list_id = 'inbox' ORDER BY sort_order`).all()).toEqual([
    { id: "later", sort_order: 0, updated_at: laterStamp },
    { id: "inbox-open", sort_order: 1, updated_at: laterStamp },
  ]);
});

it("loads one list, an attachment name, and skips children, trash, and other lists", async () => {
  const db = await prepare();
  insertList(db, "work", "Work");
  insertSection(db, "work-open", "work", "Open", 0);
  insertTask(db, "loose", { section: null, title: "Loose", sort: 2 });
  insertTask(db, "child", { parent: "loose", section: "inbox-open" });
  insertTask(db, "trash", { deleted: stamp, section: "inbox-open" });
  insertTask(db, "elsewhere", { list: "work", section: "work-open" });
  db.prepare(`INSERT INTO tags (id, name, color, created_at) VALUES ('home', 'Home', '#ffdc58', $created)`).run({ $created: stamp });
  db.prepare(`INSERT INTO task_tags (task_id, tag_id) VALUES ('loose', 'home')`).run();
  db.prepare(`INSERT INTO attachments (id, task_id, file_name, byte_size, created_at) VALUES ('file-1', 'loose', 'notes.pdf', 12, $created)`).run({
    $created: stamp,
  });
  db.prepare(`INSERT INTO attachments (id, task_id, file_name, byte_size, created_at) VALUES ('file-2', 'trash', 'secret.pdf', 4, $created)`).run({
    $created: stamp,
  });
  db.prepare(`UPDATE settings SET value = '24' WHERE key = 'clock'`).run();
  const loaded = await loadBoardOn(tracing(db), null);
  expect(loaded.list?.id).toBe("inbox");
  expect(loaded.clock).toBe("24");
  expect(loaded.tasks.map((item) => item.id)).toEqual(["loose"]);
  expect(loaded.files).toEqual([{ id: "file-1", taskId: "loose", fileName: "notes.pdf" }]);
  expect(loaded.links).toEqual([{ taskId: "loose", tagId: "home" }]);
  expect(loaded.tags.map((tag) => tag.name)).toContain("Home");
  const missing = await loadBoardOn(tracing(db), "missing");
  expect(missing.list?.id).toBe("inbox");
  const work = await loadBoardOn(tracing(db), "work");
  expect(work.list?.id).toBe("work");
  expect(work.tasks.map((item) => item.id)).toEqual(["elsewhere"]);
  expect(work.files).toEqual([]);
});
