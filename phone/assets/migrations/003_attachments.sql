CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX attachments_task ON attachments(task_id);
