export type MigrationFile = { version: number; sql: string };

export type MigrationDb = {
  exec(sql: string): Promise<void>;
  all(sql: string, values?: readonly (string | number | null)[]): Promise<Record<string, unknown>[]>;
  run(sql: string, values?: readonly (string | number | null)[]): Promise<void>;
  transaction(body: () => Promise<void>): Promise<void>;
};

const LINK_STATE = `CREATE TABLE IF NOT EXISTS link_state (
  id TEXT PRIMARY KEY CHECK (id = 'desktop'),
  have_at TEXT NOT NULL DEFAULT '',
  have_id TEXT NOT NULL DEFAULT '',
  ack_at TEXT NOT NULL DEFAULT '',
  ack_id TEXT NOT NULL DEFAULT ''
)`;

/** Applies each missing version, then ensures the phone-only cursor row. The SQL files do not create schema_migrations. */
export async function applyMigrations(db: MigrationDb, files: readonly MigrationFile[]): Promise<void> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
  const present = await db.all("SELECT version FROM schema_migrations");
  const have = new Set(present.map((row) => Number(row.version)));
  const ordered = [...files].sort((left, right) => left.version - right.version);
  for (const file of ordered) {
    if (have.has(file.version)) continue;
    await db.transaction(async () => {
      await db.exec(file.sql);
      await db.run("INSERT INTO schema_migrations (version) VALUES ($1)", [file.version]);
    });
  }
  await db.exec(LINK_STATE);
  await db.run("INSERT INTO link_state (id) VALUES ('desktop') ON CONFLICT(id) DO NOTHING");
}
