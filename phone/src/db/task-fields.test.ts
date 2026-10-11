import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("task field tests drive SQL through node:sqlite");
  },
}));

import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
import { addReminderOn } from "./reminders";
import { createOn, patchOn } from "./tasks";
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
  return db;
}

it("saves pin, duration, and a reminder on a due task", async () => {
  const db = await prepare();
  const run: Run = nodeRun(db, () => stamp);
  const created = await createOn(
    run,
    { title: "call", listId: "inbox", sectionId: "inbox-open", dueOn: "2026-10-11", parentId: null },
    stamp,
    "call-1",
  );
  expect(created.status).toBe("saved");
  if (created.status !== "saved") return;
  const patched = await patchOn(run, created.row, { pinned: true, durationMinutes: 30, important: true }, "2026-10-10T12:01:00.000Z", false);
  expect(patched.status).toBe("saved");
  if (patched.status !== "saved") return;
  expect(patched.row.pinned).toBe(true);
  expect(patched.row.durationMinutes).toBe(30);
  const row = db.prepare(`SELECT pinned, duration_minutes, important FROM tasks WHERE id = 'call-1'`).get() as {
    pinned: number;
    duration_minutes: number;
    important: number;
  };
  expect(row).toEqual({ pinned: 1, duration_minutes: 30, important: 1 });
  const reminder = await addReminderOn(run, "call-1", 15, "2026-10-10T12:02:00.000Z", "rem-1");
  expect(reminder).toEqual({ status: "saved", row: { id: "rem-1", minutesBefore: 15 } });
  const early = await addReminderOn(run, "call-1", 15, stamp, "rem-2");
  expect(early).toEqual({ status: "error", message: "That reminder is already set." });
  const rejected = await patchOn(run, patched.row, { durationMinutes: 2 }, stamp, false);
  expect(rejected).toEqual({ status: "error", message: "Duration is 5 to 1440 minutes." });
});
