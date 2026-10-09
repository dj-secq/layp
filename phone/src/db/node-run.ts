import { DatabaseSync } from "node:sqlite";
import { nowIso } from "@layp/shared";
import { isQuery, type Run, type SqlBatch, type SqlStatement } from "./sql";

export function openMemory(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export function named(values: readonly (string | number | null)[] | undefined): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  (values ?? []).forEach((value, index) => {
    out[`$${index + 1}`] = value;
  });
  return out;
}

/** Test driver. The phone uses `withTransactionAsync` and does not send this BEGIN as sync SQL. */
export function nodeRun(db: DatabaseSync, clock: () => string = nowIso): Run {
  return async (statements) => {
    db.exec("BEGIN");
    const batches: SqlBatch[] = [];
    try {
      for (const statement of statements) batches.push(execute(db, statement));
      const now = clock();
      db.exec("COMMIT");
      return { batches, now };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
}

function execute(db: DatabaseSync, statement: SqlStatement): SqlBatch {
  const statementSync = db.prepare(statement.sql);
  const params = named(statement.values);
  if (isQuery(statement.sql)) {
    const rows = (statement.values?.length ? statementSync.all(params) : statementSync.all()) as Record<string, unknown>[];
    return { rows, rowsAffected: rows.length };
  }
  const result = statement.values?.length ? statementSync.run(params) : statementSync.run();
  return { rows: [], rowsAffected: Number(result.changes) };
}
