import { nowIso } from "@layp/shared";
import type { SQLiteDatabase } from "expo-sqlite";
import { openPhoneDatabase } from "./open";
import { isQuery, type Run, type SqlBatch, type SqlStatement, type SqlTxResult } from "./sql";

let queue: Promise<unknown> = Promise.resolve();

/** One entry point. `run` does not acquire, so a nested `withLock` waits until this callback returns. */
export function withLock<T>(body: (run: Run) => Promise<T>): Promise<T> {
  const result = queue.then(() => body(runStatements));
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Queue, then `nowIso()`, then `run`. The stamp is not sampled before the wait. */
export function withStamp<T>(write: (stamp: string, run: Run) => Promise<T>): Promise<T> {
  return withLock(async (run) => write(nowIso(), run));
}

async function runStatements(statements: SqlStatement[]): Promise<SqlTxResult> {
  const db = await openPhoneDatabase();
  const batches: SqlBatch[] = [];
  let now = "";
  await db.withTransactionAsync(async () => {
    batches.length = 0;
    for (const statement of statements) {
      batches.push(await executeStatement(db, statement));
    }
    // After the statements and before commit. Callers use this clock instead of sampling again.
    now = nowIso();
  });
  return { batches, now };
}

async function executeStatement(db: SQLiteDatabase, statement: SqlStatement): Promise<SqlBatch> {
  // Array index i binds sqlite parameter i + 1, so placeholders stay $1..$n in appearance order.
  const values = statement.values ? [...statement.values] : [];
  if (isQuery(statement.sql)) {
    const rows = await db.getAllAsync<Record<string, unknown>>(statement.sql, values);
    return { rows, rowsAffected: rows.length };
  }
  const result = await db.runAsync(statement.sql, values);
  return { rows: [], rowsAffected: result.changes };
}
