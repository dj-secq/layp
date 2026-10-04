-- Schema v1. Append a new migration to change this. Do not edit it after it ships.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  folder_id TEXT NULL REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  color TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  sort_order INTEGER NOT NULL,
  archived_at TEXT NULL,
  is_inbox INTEGER NOT NULL DEFAULT 0 CHECK (is_inbox IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX lists_one_inbox ON lists(is_inbox) WHERE is_inbox = 1;

CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  sort_order INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE RESTRICT,
  section_id TEXT NULL REFERENCES sections(id) ON DELETE SET NULL,
  parent_id TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 100000),
  priority TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('none', 'low', 'medium', 'high')),
  important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
  urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  start_on TEXT NULL,
  due_on TEXT NULL,
  due_time TEXT NULL,
  duration_minutes INTEGER NULL CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 1440),
  recurrence_json TEXT NULL,
  estimated_pomos INTEGER NULL,
  completed_pomos INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  completed_at TEXT NULL,
  deleted_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX tasks_list_open ON tasks(list_id, completed_at, deleted_at);
CREATE INDEX tasks_due ON tasks(due_on, deleted_at);
CREATE INDEX tasks_series ON tasks(series_id);
CREATE INDEX tasks_parent ON tasks(parent_id);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  minutes_before INTEGER NOT NULL CHECK (minutes_before BETWEEN 0 AND 10080),
  fired_at TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE task_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE TABLE filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE days (
  day TEXT PRIMARY KEY,
  diary TEXT NOT NULL DEFAULT '',
  mood INTEGER NULL CHECK (mood IS NULL OR mood BETWEEN 1 AND 5),
  sleep_hours REAL NULL CHECK (sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24)),
  sleep_bed TEXT NULL,
  sleep_wake TEXT NULL,
  workout TEXT NULL CHECK (workout IS NULL OR workout IN ('yes', 'no')),
  workout_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE trackers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('check', 'count', 'number', 'scale', 'minutes')),
  unit TEXT NULL,
  daily_target REAL NULL,
  color TEXT NOT NULL,
  is_hobby INTEGER NOT NULL DEFAULT 0 CHECK (is_hobby IN (0, 1)),
  schedule_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  archived_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tracker_logs (
  id TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('done', 'skipped')),
  value REAL NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (tracker_id, day)
);

CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  minutes INTEGER NOT NULL
);

CREATE TABLE timer_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  task_id TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN ('idle', 'work', 'break')),
  running INTEGER NOT NULL CHECK (running IN (0, 1)),
  remaining_seconds INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE countdowns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_on TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('theme', 'light'),
  ('week_start', 'monday'),
  ('close_behavior', 'quit'),
  ('quick_add_shortcut', 'Ctrl+Shift+Space'),
  ('pomo_work_minutes', '25'),
  ('pomo_break_minutes', '5'),
  ('clock', '12');

INSERT INTO lists (
  id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at
) VALUES (
  'inbox', NULL, 'Inbox', '#ffdc58', 0, NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO sections (id, list_id, name, sort_order) VALUES
  ('inbox-open', 'inbox', 'Open', 0);
