import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  MIGRATION_INSTANT,
  ZERO_CURSOR,
  applyStatements,
  changesSinceStatements,
  decodeChangesSince,
  matchesCursor,
  nextCursor,
  remoteWins,
  type SqlStatement,
  type SyncRow,
} from "./sync";

function taskRow(id: string, updatedAt: string, extra: Record<string, string | number | null> = {}, tagIds: string[] = []): SyncRow {
  return {
    entity: "tasks",
    id,
    updatedAt,
    tagIds,
    row: {
      id,
      series_id: id,
      list_id: "inbox",
      section_id: "inbox-open",
      parent_id: null,
      title: "Task",
      notes: "",
      priority: "none",
      important: 0,
      urgent: 0,
      pinned: 0,
      start_on: null,
      due_on: null,
      due_time: null,
      duration_minutes: null,
      recurrence_json: null,
      estimated_pomos: null,
      completed_pomos: 0,
      sort_order: 1,
      completed_at: null,
      deleted_at: null,
      created_at: "2026-10-08T01:00:00.000Z",
      updated_at: updatedAt,
      ...extra,
    },
  };
}

it("keeps the desktop row on a tie and replaces the phone row", () => {
  expect(remoteWins(null, "2026-10-08T00:00:00.000Z", "desktop")).toBe(true);
  expect(remoteWins("2026-10-08T00:00:00.000Z", "2026-10-08T01:00:00.000Z", "desktop")).toBe(true);
  expect(remoteWins("2026-10-08T02:00:00.000Z", "2026-10-08T01:00:00.000Z", "phone")).toBe(false);
  expect(remoteWins("2026-10-08T01:00:00.000Z", "2026-10-08T01:00:00.000Z", "desktop")).toBe(false);
  expect(remoteWins("2026-10-08T01:00:00.000Z", "2026-10-08T01:00:00.000Z", "phone")).toBe(true);
});

it("does not acknowledge the open millisecond, and the zero cursor matches the migration instant", () => {
  const now = "2026-10-08T12:00:00.500Z";
  const open = "2026-10-08T12:00:00.500Z";
  expect(
    nextCursor(
      ZERO_CURSOR,
      [
        { stamp: open, id: "task-b" },
        { stamp: open, id: "task-a" },
        { stamp: "2026-10-08T12:00:00.100Z", id: "focus-1" },
      ],
      now,
    ),
  ).toEqual({ at: "2026-10-08T12:00:00.100Z", id: "focus-1" });
  expect(
    nextCursor(
      ZERO_CURSOR,
      [
        { stamp: open, id: "task-a" },
        { stamp: open, id: "focus-1" },
      ],
      now,
    ),
  ).toEqual(ZERO_CURSOR);
  expect(
    nextCursor(
      ZERO_CURSOR,
      [
        { stamp: "2026-10-08T12:00:00.100Z", id: "a" },
        { stamp: "2026-10-08T12:00:00.100Z", id: "m" },
      ],
      now,
    ),
  ).toEqual({ at: "2026-10-08T12:00:00.100Z", id: "m" });
  expect(matchesCursor(MIGRATION_INSTANT, "inbox-open", ZERO_CURSOR)).toBe(true);
  expect(matchesCursor(MIGRATION_INSTANT, "inbox-open", { at: MIGRATION_INSTANT, id: "inbox-open" })).toBe(false);
  expect(MIGRATION_INSTANT > MIGRATION_INSTANT).toBe(false);
});

it("emits the parent task before its child and defers foreign keys", () => {
  const statements = applyStatements(
    {
      rows: [
        taskRow("child", "2026-10-08T03:00:00.000Z", { parent_id: "parent" }),
        taskRow("parent", "2026-10-08T03:00:00.000Z"),
      ],
      deletions: [],
    },
    "desktop",
  );
  expect(statements[0]?.sql).toBe("PRAGMA defer_foreign_keys = ON");
  const inserts = statements.filter((statement) => statement.sql.startsWith("INSERT INTO tasks"));
  expect(inserts.map((statement) => statement.values[0])).toEqual(["parent", "child"]);
});

it("uses one tag delete plus one insert per tag, and an empty set inserts nothing", () => {
  const filled = applyStatements(
    { rows: [taskRow("t1", "2026-10-08T03:00:00.000Z", {}, ["tag-a", "tag-b"])], deletions: [] },
    "desktop",
  );
  expect(filled.filter((statement) => statement.sql.startsWith("DELETE FROM task_tags"))).toHaveLength(1);
  expect(filled.filter((statement) => statement.sql.startsWith("INSERT INTO task_tags"))).toHaveLength(2);
  const cleared = applyStatements(
    { rows: [taskRow("t1", "2026-10-08T03:00:00.000Z", {}, [])], deletions: [] },
    "desktop",
  );
  expect(cleared.filter((statement) => statement.sql.startsWith("DELETE FROM task_tags"))).toHaveLength(1);
  expect(cleared.filter((statement) => statement.sql.startsWith("INSERT INTO task_tags"))).toHaveLength(0);
});

it("uses > on the desktop and >= on the phone", () => {
  const row = taskRow("t1", "2026-10-08T03:00:00.000Z", {}, ["tag-a"]);
  const desktop = applyStatements({ rows: [row], deletions: [] }, "desktop");
  const phone = applyStatements({ rows: [row], deletions: [] }, "phone");
  const desktopTask = desktop.find((statement) => statement.sql.startsWith("INSERT INTO tasks"));
  const phoneTask = phone.find((statement) => statement.sql.startsWith("INSERT INTO tasks"));
  expect(desktopTask?.sql).toContain("excluded.updated_at > tasks.updated_at");
  expect(desktopTask?.sql).not.toContain(">=");
  expect(phoneTask?.sql).toContain("excluded.updated_at >= tasks.updated_at");
  expect(desktop.find((statement) => statement.sql.startsWith("DELETE FROM task_tags"))?.sql).toContain("$4 > updated_at");
  expect(phone.find((statement) => statement.sql.startsWith("DELETE FROM task_tags"))?.sql).toContain("$4 >= updated_at");
  const desktopDelete = applyStatements(
    {
      rows: [],
      deletions: [{ id: "d1", entity: "tasks", entityId: "t1", deletedAt: "2026-10-08T04:00:00.000Z" }],
    },
    "desktop",
  ).find((statement) => statement.sql.startsWith("DELETE FROM tasks"));
  const phoneDelete = applyStatements(
    {
      rows: [],
      deletions: [{ id: "d1", entity: "tasks", entityId: "t1", deletedAt: "2026-10-08T04:00:00.000Z" }],
    },
    "phone",
  ).find((statement) => statement.sql.startsWith("DELETE FROM tasks"));
  expect(desktopDelete?.sql).toContain("updated_at < $2");
  expect(phoneDelete?.sql).toContain("updated_at <= $2");
});

it("drops settings outside the allowlist and deletes tasks before lists", () => {
  const statements = applyStatements(
    {
      rows: [
        {
          entity: "settings",
          id: "phone_link",
          updatedAt: MIGRATION_INSTANT,
          row: { key: "phone_link", value: "on", updated_at: MIGRATION_INSTANT },
        },
        {
          entity: "settings",
          id: "theme",
          updatedAt: MIGRATION_INSTANT,
          row: { key: "theme", value: "light", updated_at: MIGRATION_INSTANT },
        },
      ],
      deletions: [
        { id: "d-list", entity: "lists", entityId: "list-1", deletedAt: "2026-10-08T05:00:00.000Z" },
        { id: "d-task", entity: "tasks", entityId: "task-1", deletedAt: "2026-10-08T05:00:00.000Z" },
        { id: "d-tag", entity: "tags", entityId: "tag-1", deletedAt: "2026-10-08T05:00:00.000Z" },
      ],
    },
    "desktop",
  );
  const settings = statements.filter((statement) => statement.sql.startsWith("INSERT INTO settings"));
  expect(settings.map((statement) => statement.values[0])).toEqual(["theme"]);
  const taskAt = statements.findIndex((statement) => statement.sql.startsWith("DELETE FROM tasks"));
  const listAt = statements.findIndex((statement) => statement.sql.startsWith("DELETE FROM lists"));
  const linkAt = statements.findIndex((statement) => statement.sql.startsWith("DELETE FROM task_tags"));
  const tagAt = statements.findIndex((statement) => statement.sql.startsWith("DELETE FROM tags"));
  expect(taskAt).toBeLessThan(listAt);
  expect(linkAt).toBeLessThan(tagAt);
});

it("selects from the zero cursor with the compound predicate", () => {
  const statements = changesSinceStatements(ZERO_CURSOR);
  const sections = statements.find((statement) => statement.sql.includes("FROM sections"));
  const attachments = statements.find((statement) => statement.sql.includes("FROM attachments"));
  const deletions = statements.find((statement) => statement.sql.includes("FROM deletions"));
  const settings = statements.find((statement) => statement.sql.includes("FROM settings"));
  const days = statements.find((statement) => statement.sql.includes("FROM days"));
  expect(sections?.values).toEqual(["", ""]);
  expect(sections?.sql).toContain("updated_at > $1 OR (updated_at = $1 AND id > $2)");
  expect(attachments?.sql).toContain("created_at > $1 OR (created_at = $1 AND id > $2)");
  expect(deletions?.sql).toContain("deleted_at > $1 OR (deleted_at = $1 AND id > $2)");
  expect(days?.sql).toContain("updated_at = $1 AND day > $2");
  expect(settings?.sql).toContain("AND key IN (");
  expect(settings?.sql).toContain("'theme'");
  expect(settings?.sql).not.toContain("phone_link");
  expect(settings?.sql).not.toContain("close_behavior");
  expect(matchesCursor(MIGRATION_INSTANT, "inbox-open", { at: sections?.values[0] as string, id: sections?.values[1] as string })).toBe(true);
});

function quote(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.split("'").join("''")}'`;
}

function sqlite(db: string, sql: string): string {
  return execFileSync("sqlite3", [db], { input: sql, encoding: "utf8" });
}

function applySql(db: string, statements: SqlStatement[]) {
  const body = statements.map((statement) => {
    let index = 0;
    const sql = statement.sql.replace(/\$\d+/g, () => {
      const value = statement.values[index] ?? null;
      index += 1;
      return quote(value);
    });
    return `${sql.trim()};`;
  });
  sqlite(db, `PRAGMA foreign_keys = ON;\nBEGIN IMMEDIATE;\n${body.join("\n")}\nCOMMIT;\n`);
}

function freshDb(): { dir: string; db: string } {
  const dir = mkdtempSync(join(tmpdir(), "layp-sync-"));
  const db = join(dir, "layp.db");
  const migrationDir = fileURLToPath(new URL("../../app/src-tauri/migrations/", import.meta.url));
  const schema = ["001_schema.sql", "002_checklist_reminders.sql", "003_attachments.sql", "004_fts.sql", "005_phone.sql"]
    .map((name) => readFileSync(join(migrationDir, name), "utf8"))
    .join("\n");
  sqlite(
    db,
    `${schema}
     INSERT INTO tags (id, name, color, created_at, updated_at) VALUES
       ('tag-a', 'A', '#ffdc58', '2026-10-08T01:00:00.000Z', '2026-10-08T01:00:00.000Z'),
       ('tag-b', 'B', '#5b8def', '2026-10-08T01:00:00.000Z', '2026-10-08T01:00:00.000Z');
     INSERT INTO tasks (
       id, series_id, list_id, section_id, title, sort_order, created_at, updated_at
     ) VALUES (
       't1', 't1', 'inbox', 'inbox-open', 'Keep', 1,
       '2026-10-08T01:00:00.000Z', '2026-10-08T01:00:00.000Z'
     );
     INSERT INTO task_tags (task_id, tag_id) VALUES ('t1', 'tag-a'), ('t1', 'tag-b');`,
  );
  return { dir, db };
}

it("clears links for a newer empty tag set and leaves them when a desktop apply ties", () => {
  const cleared = freshDb();
  const tied = freshDb();
  const phoneTied = freshDb();
  try {
    applySql(
      cleared.db,
      applyStatements(
        {
          rows: [taskRow("t1", "2026-10-08T04:00:00.000Z", { title: "Cleared" }, [])],
          deletions: [],
        },
        "desktop",
      ),
    );
    expect(sqlite(cleared.db, "SELECT COUNT(*) FROM task_tags WHERE task_id = 't1';").trim()).toBe("0");
    expect(sqlite(cleared.db, "SELECT title FROM tasks WHERE id = 't1';").trim()).toBe("Cleared");

    applySql(
      tied.db,
      applyStatements(
        {
          rows: [taskRow("t1", "2026-10-08T01:00:00.000Z", { title: "Replaced" }, [])],
          deletions: [],
        },
        "desktop",
      ),
    );
    expect(sqlite(tied.db, "SELECT COUNT(*) FROM task_tags WHERE task_id = 't1';").trim()).toBe("2");
    expect(sqlite(tied.db, "SELECT title FROM tasks WHERE id = 't1';").trim()).toBe("Keep");

    applySql(
      phoneTied.db,
      applyStatements(
        {
          rows: [taskRow("t1", "2026-10-08T01:00:00.000Z", { title: "Replaced" }, [])],
          deletions: [],
        },
        "phone",
      ),
    );
    expect(sqlite(phoneTied.db, "SELECT COUNT(*) FROM task_tags WHERE task_id = 't1';").trim()).toBe("0");
    expect(sqlite(phoneTied.db, "SELECT title FROM tasks WHERE id = 't1';").trim()).toBe("Replaced");
  } finally {
    rmSync(cleared.dir, { recursive: true, force: true });
    rmSync(tied.dir, { recursive: true, force: true });
    rmSync(phoneTied.dir, { recursive: true, force: true });
  }
});

it("attaches tag ids from the tasks batch column list", () => {
  const statements = changesSinceStatements(ZERO_CURSOR);
  const tasks = statements.find((statement) => statement.sql.includes("FROM tasks WHERE"));
  expect(tasks).toBeTruthy();
  const columns = tasks!.sql.slice("SELECT ".length, tasks!.sql.indexOf(" FROM tasks WHERE")).split(", ");
  const raw: Record<string, unknown> = {};
  for (const column of columns) {
    if (column === "id") raw[column] = "task-1";
    else if (column === "updated_at" || column === "created_at") raw[column] = "2026-10-08T01:00:00.000Z";
    else if (column === "title") raw[column] = "Task";
    else if (column === "list_id" || column === "series_id") raw[column] = "inbox";
    else if (column === "important" || column === "urgent" || column === "pinned" || column === "completed_pomos" || column === "sort_order") raw[column] = 0;
    else raw[column] = null;
  }
  const batches = statements.map(() => ({ rows: [] as Record<string, unknown>[] }));
  batches[statements.findIndex((statement) => statement.sql.includes("FROM tasks WHERE"))] = { rows: [raw] };
  batches[statements.findIndex((statement) => statement.sql.includes("FROM task_tags"))] = {
    rows: [{ task_id: "task-1", tag_id: "tag-1" }],
  };
  batches[statements.findIndex((statement) => statement.sql.includes("FROM deletions"))] = {
    rows: [
      { id: "del-1", entity: "tasks", entity_id: "gone", deleted_at: "2026-10-08T02:00:00.000Z" },
      { id: "del-2", entity: "not-a-table", entity_id: "x", deleted_at: "2026-10-08T02:00:00.000Z" },
    ],
  };
  const decoded = decodeChangesSince(batches);
  expect(decoded.rows.map((row) => row.entity)).toEqual(["tasks"]);
  expect(decoded.rows[0]?.tagIds).toEqual(["tag-1"]);
  expect(decoded.rows[0]?.id).toBe("task-1");
  expect(decoded.deletions).toEqual([{ id: "del-1", entity: "tasks", entityId: "gone", deletedAt: "2026-10-08T02:00:00.000Z" }]);
});
