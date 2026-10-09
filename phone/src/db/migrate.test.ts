import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrations } from "./migrations.generated";
import { applyMigrations, type MigrationDb } from "./migrate";
import { named, openMemory } from "./node-run";

const sourceDir = fileURLToPath(new URL("../../../app/src-tauri/migrations/", import.meta.url));

function driver(db: DatabaseSync): MigrationDb {
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    all: async (sql, values) => {
      const statement = db.prepare(sql);
      const rows = values?.length ? statement.all(named(values)) : statement.all();
      return rows as Record<string, unknown>[];
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
  };
}

it("applies the Tauri migrations once and keeps link_state", async () => {
  const names = readdirSync(sourceDir).filter((name) => name.endsWith(".sql")).sort();
  expect(migrations.map((file) => file.version)).toEqual([1, 2, 3, 4, 5]);
  names.forEach((name, index) => {
    expect(migrations[index]?.sql).toBe(readFileSync(path.join(sourceDir, name), "utf8"));
  });

  const db = openMemory();
  await applyMigrations(driver(db), migrations);
  await applyMigrations(driver(db), migrations);

  const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[];
  expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
  const link = db.prepare("SELECT id, have_at, ack_at FROM link_state").all() as { id: string; have_at: string; ack_at: string }[];
  expect(link).toEqual([{ id: "desktop", have_at: "", ack_at: "" }]);
  const fts = db.prepare("SELECT name FROM sqlite_master WHERE name = 'tasks_fts'").all();
  expect(fts).toHaveLength(1);
});
