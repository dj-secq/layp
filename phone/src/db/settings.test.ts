import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("settings tests drive SQL through node:sqlite");
  },
}));

import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
import { readSettings, writeSetting } from "./settings";
import type { Run } from "./sql";

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

it("reads the paper theme and stamps a new theme", async () => {
  const db = await prepare();
  const run: Run = nodeRun(db, () => "2026-10-10T00:00:00.000Z");
  expect((await readSettings(run)).theme).toBe("light");
  await writeSetting(run, "theme", "sage", "2026-10-10T01:00:00.000Z");
  expect((await readSettings(run)).theme).toBe("sage");
  const row = db.prepare(`SELECT value, updated_at FROM settings WHERE key = 'theme'`).get() as { value: string; updated_at: string };
  expect(row).toEqual({ value: "sage", updated_at: "2026-10-10T01:00:00.000Z" });
  await writeSetting(run, "theme", "nope", "2026-10-10T02:00:00.000Z");
  expect((await readSettings(run)).theme).toBe("light");
});
