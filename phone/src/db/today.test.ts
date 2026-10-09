import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { rule, serializeRule } from "@layp/shared";
import { expect, it } from "vitest";
import { completeOn, occurrenceStatements } from "./complete";
import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
import type { Run } from "./sql";
import { loadToday } from "./today";

const stamp = "2026-10-08T18:00:00.000Z";

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
  db.prepare(
    `INSERT INTO lists (id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at)
     VALUES ('work', NULL, 'Work', '#ffdc58', 1, NULL, 0, $created, $created)`,
  ).run({ $created: stamp });
  db.prepare(`INSERT INTO sections (id, list_id, name, sort_order) VALUES ('deep', 'work', 'Deep', 0)`).run();
  db.prepare(`INSERT INTO tags (id, name, color, created_at) VALUES ('tag-a', 'Home', '#ffdc58', $created)`).run({ $created: stamp });
  db.prepare(`INSERT INTO tags (id, name, color, created_at) VALUES ('tag-b', 'Errand', '#cae6ff', $created)`).run({ $created: stamp });
  insertTask(db, "gym", "2026-10-08", 4, 1);
  insertTask(db, "later", "2026-10-09", 5, 0);
  db.prepare(`INSERT INTO task_tags (task_id, tag_id) VALUES ('gym', 'tag-a')`).run();
  db.prepare(`INSERT INTO task_tags (task_id, tag_id) VALUES ('gym', 'tag-b')`).run();
  db.prepare(
    `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at) VALUES ('rem-15', 'gym', 15, NULL, $created)`,
  ).run({ $created: stamp });
  db.prepare(
    `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at) VALUES ('rem-60', 'gym', 60, NULL, $created)`,
  ).run({ $created: stamp });
  db.prepare(
    `INSERT INTO checklist_reminders (id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at)
     VALUES ('check-1', 'gym', 'shoes', '2026-10-08', NULL, 5, NULL, $created)`,
  ).run({ $created: stamp });
  return db;
}

function insertTask(db: DatabaseSync, id: string, dueOn: string, sortOrder: number, pinned: number): void {
  db.prepare(
    `INSERT INTO tasks (
      id, series_id, list_id, section_id, parent_id, title, notes, priority,
      important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
      estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
    ) VALUES (
      $id, 'series-1', 'work', 'deep', NULL, 'Gym', 'bring shoes', 'high',
      1, 0, $pinned, '2026-10-06', $due, '18:00', 30, $rule,
      4, 0, $sort, NULL, NULL, $created, $created
    )`,
  ).run({
    $id: id,
    $due: dueOn,
    $pinned: pinned,
    $rule: serializeRule(rule({ freq: "daily", end: { type: "count", remaining: 3 } })),
    $sort: sortOrder,
    $created: stamp,
  });
}

it("returns a non-inbox section and tag names, and skips another day", async () => {
  const db = await prepare();
  const tasks = await loadToday(nodeRun(db), "2026-10-08", "2026-10-08");
  const gym = tasks.find((task) => task.id === "gym");
  expect(gym?.sectionName).toBe("Deep");
  expect(gym?.sectionId).not.toBe("inbox-open");
  expect(gym?.tagNames).toEqual(["Errand", "Home"]);
  expect(tasks.map((task) => task.id)).not.toContain("later");
});

it("inserts the next occurrence with tags, reminder offsets, and checklist copies", async () => {
  const db = await prepare();
  const sqls: string[] = [];
  const run: Run = async (statements) => {
    sqls.push(...statements.map((statement) => statement.sql));
    return nodeRun(db, () => "2099-01-01T00:00:00.000Z")(statements);
  };
  const ids = ["next-1", "rem-next-15", "rem-next-60", "check-next"];
  const result = await completeOn(run, "gym", stamp, "2026-10-08", () => ids.shift() ?? "extra");
  expect(result).toBe("saved");
  expect(sqls.some((sql) => /^\s*BEGIN/i.test(sql))).toBe(false);
  const insert = sqls.find((sql) => sql.includes("INSERT INTO tasks"));
  expect(insert).toBeTruthy();
  const numbers = [...(insert ?? "").matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const firstSeen: number[] = [];
  for (const number of numbers) if (!firstSeen.includes(number)) firstSeen.push(number);
  expect(firstSeen).toEqual([...firstSeen].sort((left, right) => left - right));
  expect(firstSeen.at(-1)).toBe(19);

  const done = db.prepare("SELECT completed_at, updated_at FROM tasks WHERE id = 'gym'").get() as {
    completed_at: string;
    updated_at: string;
  };
  expect(done).toEqual({ completed_at: stamp, updated_at: stamp });
  const next = db.prepare("SELECT id, due_on, section_id, sort_order, created_at FROM tasks WHERE id = 'next-1'").get() as {
    id: string;
    due_on: string;
    section_id: string;
    sort_order: number;
    created_at: string;
  };
  expect(next).toMatchObject({ due_on: "2026-10-09", section_id: "deep", sort_order: 6, created_at: stamp });
  const tags = db.prepare("SELECT tag_id FROM task_tags WHERE task_id = 'next-1' ORDER BY tag_id").all() as { tag_id: string }[];
  expect(tags.map((row) => row.tag_id)).toEqual(["tag-a", "tag-b"]);
  const reminders = db.prepare("SELECT minutes_before, fired_at, created_at FROM reminders WHERE task_id = 'next-1' ORDER BY minutes_before").all() as {
    minutes_before: number;
    fired_at: string | null;
    created_at: string;
  }[];
  expect(reminders).toEqual([
    { minutes_before: 15, fired_at: null, created_at: stamp },
    { minutes_before: 60, fired_at: null, created_at: stamp },
  ]);
  const checks = db.prepare(
    "SELECT line_text, due_on, due_time, minutes_before, fired_at, created_at, updated_at FROM checklist_reminders WHERE task_id = 'next-1'",
  ).all() as { line_text: string; due_on: string; due_time: string | null; minutes_before: number; fired_at: string | null; created_at: string; updated_at: string }[];
  expect(checks).toEqual([
    { line_text: "shoes", due_on: "2026-10-08", due_time: null, minutes_before: 5, fired_at: null, created_at: stamp, updated_at: stamp },
  ]);
  expect(await completeOn(run, "gym", stamp, "2026-10-08", () => "nope")).toBe("none");
  const spawned = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE series_id = 'series-1' AND id != 'gym' AND id != 'later'").get() as {
    count: number;
  };
  expect(Number(spawned.count)).toBe(1);
  expect(occurrenceStatements).toBeTypeOf("function");
});
