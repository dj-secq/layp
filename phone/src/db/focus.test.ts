import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("focus tests drive SQL through node:sqlite");
  },
}));

import { recordFocusOn } from "./focus";
import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
import type { Run } from "./sql";

const stamp = "2026-10-10T12:00:00.000Z";
const ended = "2026-10-10T12:00:00.000Z";

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
      'pages', 'pages', 'inbox', 'inbox-open', NULL, 'Pages', '', 'none',
      0, 0, 0, NULL, NULL, NULL, NULL, NULL,
      NULL, 0, 0, NULL, NULL, $created, $created
    )`,
  ).run({ $created: stamp });
  return db;
}

it("records a finished work block and counts a pomodoro", async () => {
  const db = await prepare();
  const run: Run = nodeRun(db, () => stamp);
  await recordFocusOn(run, "pages", 0, stamp, "skip", ended);
  expect(db.prepare(`SELECT COUNT(*) AS count FROM focus_sessions`).get()).toEqual({ count: 0 });

  await recordFocusOn(run, "pages", 25, stamp, "block-1", ended);
  const session = db.prepare(`SELECT task_id, started_at, ended_at, minutes, updated_at FROM focus_sessions WHERE id = 'block-1'`).get();
  expect(session).toEqual({
    task_id: "pages",
    started_at: "2026-10-10T11:35:00.000Z",
    ended_at: ended,
    minutes: 25,
    updated_at: stamp,
  });
  expect(db.prepare(`SELECT completed_pomos, updated_at FROM tasks WHERE id = 'pages'`).get()).toEqual({
    completed_pomos: 1,
    updated_at: stamp,
  });

  await recordFocusOn(run, null, 5, stamp, "block-2", ended);
  expect(db.prepare(`SELECT task_id, minutes FROM focus_sessions WHERE id = 'block-2'`).get()).toEqual({
    task_id: null,
    minutes: 5,
  });
  expect(db.prepare(`SELECT completed_pomos FROM tasks WHERE id = 'pages'`).get()).toEqual({ completed_pomos: 1 });
});
