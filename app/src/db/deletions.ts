import type { Run, SqlStatement, SqlTxResult } from "./client";

export function deletionStatement(entity: string, entityId: string, stamp: string): SqlStatement {
  return {
    sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
    values: [crypto.randomUUID(), entity, entityId, stamp],
  };
}

/** One deletions row, then the rest of the statements, in this same transaction. */
export function recordDeletion(
  entity: string,
  entityId: string,
  stamp: string,
  run: Run,
  statements: SqlStatement[] = [],
): Promise<SqlTxResult> {
  return run([deletionStatement(entity, entityId, stamp), ...statements]);
}
