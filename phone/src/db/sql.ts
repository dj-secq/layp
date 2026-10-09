export type SqlStatement = { sql: string; values?: readonly (string | number | null)[] };
export type SqlBatch = { rows: Record<string, unknown>[]; rowsAffected: number };
export type SqlTxResult = { batches: SqlBatch[]; now: string };
export type Run = (statements: SqlStatement[]) => Promise<SqlTxResult>;

export function isQuery(sql: string): boolean {
  const word = sql.trimStart().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  return word === "select" || word === "pragma" || word === "with" || word === "values";
}
