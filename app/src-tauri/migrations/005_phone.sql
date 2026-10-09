-- Schema v5. Phone link. Append-only. Do not edit 001–004.
-- The migration instant is a nowIso() shape. It is not the sync cursor.

ALTER TABLE sections ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-10-08T00:00:00.000Z';

ALTER TABLE tags ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-10-08T00:00:00.000Z';
UPDATE tags SET updated_at = created_at;

ALTER TABLE reminders ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-10-08T00:00:00.000Z';
UPDATE reminders SET updated_at = created_at;

ALTER TABLE checklist_reminders ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-10-08T00:00:00.000Z';
UPDATE checklist_reminders SET updated_at = created_at;

ALTER TABLE countdowns ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-10-08T00:00:00.000Z';
UPDATE countdowns SET updated_at = created_at;

ALTER TABLE settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-10-08T00:00:00.000Z';

ALTER TABLE focus_sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-10-08T00:00:00.000Z';

CREATE TABLE deletions (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX deletions_entity ON deletions(entity, entity_id);
CREATE INDEX deletions_at ON deletions(deleted_at);

CREATE TABLE paired_phone (
  id TEXT PRIMARY KEY CHECK (id = 'phone'),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  paired_at TEXT NOT NULL,
  last_sync_at TEXT NULL,
  have_at TEXT NOT NULL DEFAULT '',
  have_id TEXT NOT NULL DEFAULT '',
  ack_at TEXT NOT NULL DEFAULT '',
  ack_id TEXT NOT NULL DEFAULT ''
);

INSERT INTO settings (key, value, updated_at)
VALUES ('phone_link', 'off', '2026-10-08T00:00:00.000Z')
ON CONFLICT(key) DO NOTHING;
