import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("search tests drive SQL through node:sqlite");
  },
}));

import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
import { searchOn } from "./search";
import type { Run } from "./sql";

const stamp = "2026-10-10T12:00:00.000Z";

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
    `INSERT INTO tasks (
      id, series_id, list_id, section_id, parent_id, title, notes, priority,
      important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
      estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
    ) VALUES (
      'pages', 'pages', 'inbox', 'inbox-open', NULL, 'Pages', 'margin notes', 'none',
      0, 0, 0, NULL, NULL, NULL, NULL, NULL,
      NULL, 0, 0, NULL, NULL, $created, $created
    )`,
  ).run({ $created: stamp });
  db.prepare(`INSERT INTO days (day, diary, updated_at) VALUES ('2026-10-10', 'beach walk', $created)`).run({ $created: stamp });
  return db;
}

it("searches tasks and days, and an empty query returns nothing", async () => {
  const db = await prepare();
  const run: Run = nodeRun(db, () => stamp);
  expect(await searchOn(run, "  ")).toEqual({ tasks: [], days: [] });
  const letter = await searchOn(run, "P");
  expect(letter.tasks.map((task) => task.title)).toEqual(["Pages"]);
  const phrase = await searchOn(run, "Pages");
  expect(phrase.tasks.map((task) => task.id)).toEqual(["pages"]);
  const days = await searchOn(run, "beach");
  expect(days.days).toEqual([{ day: "2026-10-10", label: "Diary" }]);
});
