import { Paths } from "expo-file-system";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { migrations } from "./migrations.generated";
import { applyMigrations, type MigrationDb } from "./migrate";

let opening: Promise<SQLiteDatabase> | null = null;

export function openPhoneDatabase(): Promise<SQLiteDatabase> {
  if (!opening) {
    opening = openFresh().catch((err: unknown) => {
      opening = null;
      throw err;
    });
  }
  return opening;
}

async function openFresh(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync("layp.db", {}, Paths.document.uri);
  await db.execAsync("PRAGMA foreign_keys = ON");
  await db.execAsync("PRAGMA busy_timeout = 5000");
  try {
    await db.execAsync("PRAGMA journal_mode = WAL");
  } catch {
    console.error("database open failed");
  }
  await applyMigrations(expoMigrationDb(db), migrations);
  return db;
}

function expoMigrationDb(db: SQLiteDatabase): MigrationDb {
  return {
    exec: (sql) => db.execAsync(sql),
    all: (sql, values) => db.getAllAsync<Record<string, unknown>>(sql, values ? [...values] : []),
    run: async (sql, values) => {
      await db.runAsync(sql, values ? [...values] : []);
    },
    transaction: (body) => db.withTransactionAsync(body),
  };
}
