import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("catalog tests drive SQL through node:sqlite");
  },
}));

import { createFolderOn, createListOn } from "./lists";
import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
import { tasksUpcomingOn } from "./queries";
import type { Run } from "./sql";
import { createOn } from "./tasks";

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
  return db;
}

it("creates a list with an Open section and a folder", async () => {
  const db = await prepare();
  const run: Run = nodeRun(db, () => stamp);
  const list = await createListOn(run, "School", "#ffdc58", stamp, "school", "school-open");
  expect(list.status).toBe("saved");
  const section = db.prepare(`SELECT name, list_id FROM sections WHERE id = 'school-open'`).get() as { name: string; list_id: string };
  expect(section).toEqual({ name: "Open", list_id: "school" });
  const folder = await createFolderOn(run, "Work", stamp, "work");
  expect(folder.status).toBe("saved");
  const bad = await createListOn(run, "Nope", "#000000", stamp, "nope", "nope-open");
  expect(bad.status).toBe("error");
});

it("upcoming skips today and days past the next week", async () => {
  const db = await prepare();
  const run: Run = nodeRun(db, () => stamp);
  const today = "2026-10-10";
  await createOn(run, { title: "late", listId: "inbox", sectionId: "inbox-open", dueOn: "2026-10-09" }, stamp, "late");
  await createOn(run, { title: "now", listId: "inbox", sectionId: "inbox-open", dueOn: today }, stamp, "now");
  await createOn(run, { title: "soon", listId: "inbox", sectionId: "inbox-open", dueOn: "2026-10-12" }, stamp, "soon");
  await createOn(run, { title: "later", listId: "inbox", sectionId: "inbox-open", dueOn: "2026-10-18" }, stamp, "later");
  const rows = await tasksUpcomingOn(run, today);
  expect(rows.map((task) => task.title)).toEqual(["late", "soon"]);
});
