import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("journal tests drive SQL through node:sqlite");
  },
}));

import { insertTrackerOn, updateTrackerOn, upsertLogOn } from "./journal";
import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
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

it("keeps the tracker kind after the first log", async () => {
  const db = await prepare();
  const run: Run = nodeRun(db, () => stamp);
  const created = await insertTrackerOn(
    run,
    { name: "Pages", kind: "check", unit: null, dailyTarget: null, schedule: { type: "daily" }, color: "#ffdc58", isHobby: false },
    stamp,
    "pages",
  );
  expect(created.status).toBe("saved");
  if (created.status !== "saved") return;
  const logged = await upsertLogOn(run, "pages", "2026-10-10", { state: "done", value: null, note: "" }, stamp, "log-1");
  expect(logged.status).toBe("saved");
  const blocked = await updateTrackerOn(
    run,
    created.row,
    { name: "Pages", kind: "count", unit: null, dailyTarget: 1, schedule: { type: "daily" }, color: "#ffdc58" },
    "2026-10-10T12:05:00.000Z",
  );
  expect(blocked).toEqual({ status: "error", message: "Kind stays after the first log." });
  const renamed = await updateTrackerOn(
    run,
    created.row,
    { name: "Reading", kind: "check", unit: null, dailyTarget: null, schedule: { type: "daily" }, color: "#86efac" },
    "2026-10-10T12:06:00.000Z",
  );
  expect(renamed.status).toBe("saved");
  if (renamed.status !== "saved") return;
  expect(renamed.row.kind).toBe("check");
  expect(renamed.row.name).toBe("Reading");
});
