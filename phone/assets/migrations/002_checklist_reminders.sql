CREATE TABLE checklist_reminders (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  line_text TEXT NOT NULL,
  due_on TEXT NOT NULL,
  due_time TEXT NULL,
  minutes_before INTEGER NOT NULL CHECK (minutes_before BETWEEN 0 AND 10080),
  fired_at TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX checklist_reminders_task ON checklist_reminders(task_id);
