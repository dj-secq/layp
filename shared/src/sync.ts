export type Side = "desktop" | "phone";
export type Cursor = { at: string; id: string };
export const ZERO_CURSOR: Cursor = { at: "", id: "" };

/** The v5 default for rows that have no earlier stamp. It is not the sync cursor. */
export const MIGRATION_INSTANT = "2026-10-08T00:00:00.000Z";

/** A plaintext sync body over this size does not open a transaction. */
export const MAX_SYNC_BYTES = 32 * 1024 * 1024;

export function syncPayloadWithinLimit(byteLength: number): boolean {
  return byteLength <= MAX_SYNC_BYTES;
}

export const SYNCED_SETTINGS = [
  "theme",
  "week_start",
  "clock",
  "pomo_work_minutes",
  "pomo_break_minutes",
  "pomo_sound_work",
  "pomo_sound_break",
  "quick_snippets",
] as const;

export function remoteWins(localStamp: string | null, remoteStamp: string, side: Side): boolean {
  if (localStamp === null) return true;
  if (remoteStamp > localStamp) return true;
  if (remoteStamp < localStamp) return false;
  return side === "phone";
}

/** Same compound compare the SELECT and the ack use. Empty `at` matches every real stamp. */
export function matchesCursor(stamp: string, id: string, cursor: Cursor): boolean {
  return stamp > cursor.at || (stamp === cursor.at && id > cursor.id);
}

/**
 * Advance only over rows whose stamp is strictly before `now`.
 * Rows in the open millisecond stay in the payload and are sent again.
 */
export function nextCursor(cursor: Cursor, rows: { stamp: string; id: string }[], now: string): Cursor {
  let next = cursor;
  for (const row of rows) {
    if (row.stamp >= now) continue;
    if (row.stamp > next.at || (row.stamp === next.at && row.id > next.id)) {
      next = { at: row.stamp, id: row.id };
    }
  }
  return next;
}

export type SyncEntity =
  | "folders"
  | "lists"
  | "sections"
  | "tasks"
  | "tags"
  | "reminders"
  | "checklist_reminders"
  | "filters"
  | "days"
  | "trackers"
  | "tracker_logs"
  | "focus_sessions"
  | "countdowns"
  | "attachments"
  | "settings";

export type SyncRow = {
  entity: SyncEntity;
  id: string;
  /** The cursor column. For attachments this is `created_at`. */
  updatedAt: string;
  row: Record<string, string | number | null>;
  /** Tasks only. Not a column. Empty still replaces the set when the stamp wins. */
  tagIds?: string[];
};

export type SyncDeletion = { id: string; entity: SyncEntity; entityId: string; deletedAt: string };
export type SyncBatch = { rows: SyncRow[]; deletions: SyncDeletion[] };
export type SqlStatement = { sql: string; values: (string | number | null)[] };

type TableSpec = {
  entity: SyncEntity;
  table: string;
  columns: string[];
  conflict: string;
  updates: string[];
  idColumn: string;
  cursorColumn: string;
};

const TASK_COLUMNS = [
  "id",
  "series_id",
  "list_id",
  "section_id",
  "parent_id",
  "title",
  "notes",
  "priority",
  "important",
  "urgent",
  "pinned",
  "start_on",
  "due_on",
  "due_time",
  "duration_minutes",
  "recurrence_json",
  "estimated_pomos",
  "completed_pomos",
  "sort_order",
  "completed_at",
  "deleted_at",
  "created_at",
  "updated_at",
];

function spec(
  entity: SyncEntity,
  columns: string[],
  updates: string[],
  conflict = "id",
  idColumn = "id",
  cursorColumn = "updated_at",
): TableSpec {
  return { entity, table: entity, columns, conflict, updates, idColumn, cursorColumn };
}

const TABLES: TableSpec[] = [
  spec("folders", ["id", "name", "sort_order", "created_at", "updated_at"], ["name", "sort_order", "updated_at"]),
  spec(
    "lists",
    ["id", "folder_id", "name", "color", "sort_order", "archived_at", "is_inbox", "created_at", "updated_at"],
    ["folder_id", "name", "color", "sort_order", "archived_at", "is_inbox", "updated_at"],
  ),
  spec("sections", ["id", "list_id", "name", "sort_order", "updated_at"], ["list_id", "name", "sort_order", "updated_at"]),
  spec("tags", ["id", "name", "color", "created_at", "updated_at"], ["name", "color", "updated_at"]),
  spec(
    "tasks",
    TASK_COLUMNS,
    TASK_COLUMNS.filter((column) => column !== "id" && column !== "created_at"),
  ),
  spec(
    "reminders",
    ["id", "task_id", "minutes_before", "fired_at", "created_at", "updated_at"],
    ["task_id", "minutes_before", "fired_at", "updated_at"],
  ),
  spec(
    "checklist_reminders",
    ["id", "task_id", "line_text", "due_on", "due_time", "minutes_before", "fired_at", "created_at", "updated_at"],
    ["task_id", "line_text", "due_on", "due_time", "minutes_before", "fired_at", "updated_at"],
  ),
  spec(
    "filters",
    ["id", "name", "rule_json", "sort_order", "created_at", "updated_at"],
    ["name", "rule_json", "sort_order", "updated_at"],
  ),
  spec(
    "days",
    ["day", "diary", "mood", "sleep_hours", "sleep_bed", "sleep_wake", "workout", "workout_note", "updated_at"],
    ["diary", "mood", "sleep_hours", "sleep_bed", "sleep_wake", "workout", "workout_note", "updated_at"],
    "day",
    "day",
  ),
  spec(
    "trackers",
    [
      "id",
      "name",
      "kind",
      "unit",
      "daily_target",
      "color",
      "is_hobby",
      "schedule_json",
      "sort_order",
      "archived_at",
      "created_at",
      "updated_at",
    ],
    [
      "name",
      "kind",
      "unit",
      "daily_target",
      "color",
      "is_hobby",
      "schedule_json",
      "sort_order",
      "archived_at",
      "updated_at",
    ],
  ),
  spec(
    "tracker_logs",
    ["id", "tracker_id", "day", "state", "value", "note", "updated_at"],
    ["state", "value", "note", "updated_at"],
    "tracker_id, day",
  ),
  spec(
    "focus_sessions",
    ["id", "task_id", "started_at", "ended_at", "minutes", "updated_at"],
    ["task_id", "started_at", "ended_at", "minutes", "updated_at"],
  ),
  spec(
    "countdowns",
    ["id", "title", "target_on", "sort_order", "created_at", "updated_at"],
    ["title", "target_on", "sort_order", "updated_at"],
  ),
  spec("attachments", ["id", "task_id", "file_name", "byte_size", "created_at"], [], "id", "id", "created_at"),
  spec("settings", ["key", "value", "updated_at"], ["value", "updated_at"], "key", "key"),
];

const BY_ENTITY = new Map(TABLES.map((table) => [table.entity, table]));

const BEFORE_TASKS: SyncEntity[] = ["folders", "tags", "lists", "sections"];
const AFTER_TASKS: SyncEntity[] = [
  "reminders",
  "checklist_reminders",
  "filters",
  "days",
  "trackers",
  "tracker_logs",
  "focus_sessions",
  "countdowns",
  "attachments",
  "settings",
];

/** Peer apply order. Task deletions stay ahead of list deletions. Tag links go before the tag. */
const DELETION_ORDER: SyncEntity[] = [
  "attachments",
  "checklist_reminders",
  "reminders",
  "tasks",
  "sections",
  "lists",
  "tracker_logs",
  "trackers",
  "tags",
  "filters",
  "folders",
  "countdowns",
  "focus_sessions",
  "days",
];

function winOp(side: Side): ">" | ">=" {
  return side === "desktop" ? ">" : ">=";
}

function loseOp(side: Side): "<" | "<=" {
  return side === "desktop" ? "<" : "<=";
}

function isSyncedSetting(key: string): boolean {
  return (SYNCED_SETTINGS as readonly string[]).includes(key);
}

function settingKey(row: SyncRow): string {
  return typeof row.row.key === "string" ? row.row.key : row.id;
}

function valuesFor(row: SyncRow, table: TableSpec): (string | number | null)[] {
  return table.columns.map((column) => {
    const value = row.row[column];
    if (value !== undefined) return value;
    if (column === table.idColumn) return row.id;
    if (column === table.cursorColumn) return row.updatedAt;
    return null;
  });
}

function upsertSql(table: TableSpec, side: Side): string {
  const holders = table.columns.map((_, index) => `$${index + 1}`).join(", ");
  const insert = `INSERT INTO ${table.table} (${table.columns.join(", ")}) VALUES (${holders})`;
  if (table.updates.length === 0) return `${insert} ON CONFLICT(${table.conflict}) DO NOTHING`;
  const sets = table.updates.map((column) => `${column} = excluded.${column}`).join(", ");
  return `${insert} ON CONFLICT(${table.conflict}) DO UPDATE SET ${sets} WHERE excluded.${table.cursorColumn} ${winOp(side)} ${table.table}.${table.cursorColumn}`;
}

function orderTasks(rows: SyncRow[]): SyncRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: SyncRow[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const visit = (row: SyncRow) => {
    if (seen.has(row.id) || visiting.has(row.id)) return;
    visiting.add(row.id);
    const parent = row.row.parent_id;
    if (typeof parent === "string") {
      const parentRow = byId.get(parent);
      if (parentRow) visit(parentRow);
    }
    visiting.delete(row.id);
    seen.add(row.id);
    ordered.push(row);
  };
  for (const row of rows) visit(row);
  return ordered;
}

function tagReplacement(taskId: string, remote: string, tagIds: string[], side: Side): SqlStatement[] {
  const op = winOp(side);
  const statements: SqlStatement[] = [
    {
      sql: `DELETE FROM task_tags WHERE task_id = $1 AND (
        NOT EXISTS (SELECT 1 FROM tasks WHERE id = $2)
        OR EXISTS (SELECT 1 FROM tasks WHERE id = $3 AND $4 ${op} updated_at)
      )`,
      values: [taskId, taskId, taskId, remote],
    },
  ];
  for (const tagId of tagIds) {
    statements.push({
      sql: `INSERT INTO task_tags (task_id, tag_id)
SELECT $1, $2
WHERE (
    NOT EXISTS (SELECT 1 FROM tasks WHERE id = $3)
    OR EXISTS (SELECT 1 FROM tasks WHERE id = $4 AND $5 ${op} updated_at)
  )
  AND EXISTS (SELECT 1 FROM tags WHERE id = $6)`,
      values: [taskId, tagId, taskId, taskId, remote, tagId],
    });
  }
  return statements;
}

function tagLinkDeletion(entityId: string, deletedAt: string, side: Side): SqlStatement {
  const op = loseOp(side);
  return {
    sql: `DELETE FROM task_tags WHERE tag_id = $1 AND (
      NOT EXISTS (SELECT 1 FROM tags WHERE id = $2)
      OR EXISTS (SELECT 1 FROM tags WHERE id = $3 AND updated_at ${op} $4)
    )`,
    values: [entityId, entityId, entityId, deletedAt],
  };
}

function emitUpserts(rows: SyncRow[], side: Side, statements: SqlStatement[]) {
  for (const row of rows) {
    if (row.entity === "settings" && !isSyncedSetting(settingKey(row))) continue;
    const table = BY_ENTITY.get(row.entity);
    if (!table) continue;
    statements.push({ sql: upsertSql(table, side), values: valuesFor(row, table) });
  }
}

export function applyStatements(batch: SyncBatch, side: Side): SqlStatement[] {
  const statements: SqlStatement[] = [{ sql: "PRAGMA defer_foreign_keys = ON", values: [] }];
  const grouped = new Map<SyncEntity, SyncRow[]>();
  for (const row of batch.rows) {
    const list = grouped.get(row.entity) ?? [];
    list.push(row);
    grouped.set(row.entity, list);
  }
  for (const entity of BEFORE_TASKS) emitUpserts(grouped.get(entity) ?? [], side, statements);
  const tasks = orderTasks(grouped.get("tasks") ?? []);
  for (const task of tasks) {
    statements.push(...tagReplacement(task.id, String(task.row.updated_at ?? task.updatedAt), task.tagIds ?? [], side));
  }
  emitUpserts(tasks, side, statements);
  for (const entity of AFTER_TASKS) emitUpserts(grouped.get(entity) ?? [], side, statements);

  for (const entity of DELETION_ORDER) {
    const table = BY_ENTITY.get(entity);
    if (!table) continue;
    for (const deletion of batch.deletions) {
      if (deletion.entity !== entity) continue;
      if (entity === "tags") statements.push(tagLinkDeletion(deletion.entityId, deletion.deletedAt, side));
      statements.push({
        sql: `DELETE FROM ${table.table} WHERE ${table.idColumn} = $1 AND ${table.cursorColumn} ${loseOp(side)} $2`,
        values: [deletion.entityId, deletion.deletedAt],
      });
    }
  }
  return statements;
}

function sinceWhere(cursorColumn: string, idColumn: string): string {
  return `${cursorColumn} > $1 OR (${cursorColumn} = $1 AND ${idColumn} > $2)`;
}

export function changesSinceStatements(cursor: Cursor): SqlStatement[] {
  const values: (string | number | null)[] = [cursor.at, cursor.id];
  const statements: SqlStatement[] = TABLES.map((table) => {
    const extra = table.entity === "settings" ? ` AND key IN (${SYNCED_SETTINGS.map((key) => `'${key}'`).join(", ")})` : "";
    return {
      sql: `SELECT ${table.columns.join(", ")} FROM ${table.table} WHERE (${sinceWhere(table.cursorColumn, table.idColumn)})${extra}`,
      values: [...values],
    };
  });
  statements.push({
    sql: `SELECT task_tags.task_id, task_tags.tag_id
FROM task_tags
JOIN tasks ON tasks.id = task_tags.task_id
WHERE tasks.updated_at > $1 OR (tasks.updated_at = $1 AND tasks.id > $2)`,
    values: [...values],
  });
  statements.push({
    sql: `SELECT id, entity, entity_id, deleted_at FROM deletions WHERE ${sinceWhere("deleted_at", "id")}`,
    values: [...values],
  });
  return statements;
}

function cell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

function isSyncEntity(value: string): value is SyncEntity {
  return BY_ENTITY.has(value as SyncEntity);
}

/** `batches` are the `changesSinceStatements` results, in that order, including tag links and deletions. */
export function decodeChangesSince(batches: { rows: Record<string, unknown>[] }[]): SyncBatch {
  if (batches.length !== TABLES.length + 2) {
    throw new Error("sync result is the wrong shape");
  }
  const tagsByTask = new Map<string, string[]>();
  for (const link of batches[TABLES.length]?.rows ?? []) {
    if (typeof link.task_id !== "string" || typeof link.tag_id !== "string") continue;
    const list = tagsByTask.get(link.task_id) ?? [];
    list.push(link.tag_id);
    tagsByTask.set(link.task_id, list);
  }
  const rows: SyncRow[] = [];
  TABLES.forEach((table, index) => {
    for (const raw of batches[index]?.rows ?? []) {
      const record: Record<string, string | number | null> = {};
      for (const column of table.columns) record[column] = cell(raw[column]);
      const idValue = record[table.idColumn];
      const stamp = record[table.cursorColumn];
      if (typeof idValue !== "string" || typeof stamp !== "string") continue;
      const row: SyncRow = { entity: table.entity, id: idValue, updatedAt: stamp, row: record };
      if (table.entity === "tasks") row.tagIds = tagsByTask.get(idValue) ?? [];
      rows.push(row);
    }
  });
  const deletions: SyncDeletion[] = [];
  for (const raw of batches[TABLES.length + 1]?.rows ?? []) {
    if (typeof raw.id !== "string" || typeof raw.entity !== "string" || typeof raw.entity_id !== "string" || typeof raw.deleted_at !== "string") {
      continue;
    }
    if (!isSyncEntity(raw.entity)) continue;
    deletions.push({ id: raw.id, entity: raw.entity, entityId: raw.entity_id, deletedAt: raw.deleted_at });
  }
  return { rows, deletions };
}

/** Rows and deletions share one cursor. A deletion's point is `deleted_at` plus the deletion id. */
export function cursorPoints(batch: SyncBatch): { stamp: string; id: string }[] {
  const points = batch.rows.map((row) => ({ stamp: row.updatedAt, id: row.id }));
  for (const deletion of batch.deletions) points.push({ stamp: deletion.deletedAt, id: deletion.id });
  return points;
}

/** Second `run` inside the desktop sync lock. */
export function pairedPhoneStatements(have: Cursor, ack: Cursor, lastSyncAt: string): SqlStatement[] {
  return [
    {
      sql: `UPDATE paired_phone
SET have_at = $1, have_id = $2, ack_at = $3, ack_id = $4, last_sync_at = $5
WHERE id = 'phone'`,
      values: [have.at, have.id, ack.at, ack.id, lastSyncAt],
    },
  ];
}
