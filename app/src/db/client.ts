import { invoke } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
import Database from "@tauri-apps/plugin-sql";
import { nowIso } from "@layp/shared";

export type DatabaseFile = {
  path: string;
  exists: boolean;
};

let opening: Promise<Database> | null = null;

export function openDatabase(): Promise<Database> {
  if (!opening) {
    opening = Database.load("sqlite:layp.db")
      .then(async (db) => {
        await db.select("PRAGMA foreign_keys = ON");
        await db.select("PRAGMA busy_timeout = 5000");
        await db.select("PRAGMA journal_mode = WAL");
        return db;
      })
      .catch((err: unknown) => {
        opening = null;
        throw err;
      });
  }
  return opening;
}

export async function query<T>(sql: string, bind: unknown[] = []): Promise<T[]> {
  const db = await openDatabase();
  return db.select<T[]>(sql, bind);
}

export async function run(sql: string, bind: unknown[] = []): Promise<number> {
  const db = await openDatabase();
  const result = await db.execute(sql, bind);
  return result.rowsAffected;
}

export function databaseFile(): Promise<DatabaseFile> {
  return invoke<DatabaseFile>("database_file");
}

export async function closeDatabase(): Promise<void> {
  const pending = opening;
  opening = null;
  if (!pending) return;
  const db = await pending;
  await db.close();
}

export type SqlStatement = { sql: string; values?: unknown[] };
export type SqlBatch = { rows: Record<string, unknown>[]; rowsAffected: number };
export type SqlTxResult = { batches: SqlBatch[]; now: string };
export type Run = (statements: SqlStatement[]) => Promise<SqlTxResult>;

let queue: Promise<unknown> = Promise.resolve();

/** One entry point. The callback's `run` does not acquire, so a nested call waits forever. */
export function withLock<T>(body: (run: Run) => Promise<T>): Promise<T> {
  const result = queue.then(() => body(runStatements));
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function withStamp<T>(write: (stamp: string, run: Run) => Promise<T>): Promise<T> {
  return withLock(async (run) => write(nowIso(), run));
}

/** One post-lock stamp and one transaction. The callback must not call this again. */
export function writeStamped(build: (stamp: string) => SqlStatement[]): Promise<{ stamp: string; batches: SqlBatch[] }> {
  return withStamp(async (stamp, run) => {
    const result = await run(build(stamp));
    return { stamp, batches: result.batches };
  });
}

function runStatements(statements: SqlStatement[]): Promise<SqlTxResult> {
  return invoke<SqlTxResult>("sql_transaction", { statements });
}

export async function logFailure(scope: string, detail?: string): Promise<void> {
  const line = detail ? `${scope}: ${detail}` : scope;
  try {
    await logError(line.slice(0, 300));
  } catch {
    // The screen still reports the failure when the log file cannot be written.
  }
}
