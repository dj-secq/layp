CREATE VIRTUAL TABLE tasks_fts USING fts5(
  title,
  notes,
  content='tasks',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER tasks_ai AFTER INSERT ON tasks WHEN new.deleted_at IS NULL BEGIN
  INSERT INTO tasks_fts(rowid, title, notes) VALUES (new.rowid, new.title, new.notes);
END;

CREATE TRIGGER tasks_ad AFTER DELETE ON tasks WHEN old.deleted_at IS NULL BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, notes) VALUES ('delete', old.rowid, old.title, old.notes);
END;

CREATE TRIGGER tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, notes)
  SELECT 'delete', old.rowid, old.title, old.notes WHERE old.deleted_at IS NULL;
  INSERT INTO tasks_fts(rowid, title, notes)
  SELECT new.rowid, new.title, new.notes WHERE new.deleted_at IS NULL;
END;

CREATE VIRTUAL TABLE days_fts USING fts5(
  diary,
  content='days',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER days_ai AFTER INSERT ON days BEGIN
  INSERT INTO days_fts(rowid, diary) VALUES (new.rowid, new.diary);
END;

CREATE TRIGGER days_ad AFTER DELETE ON days BEGIN
  INSERT INTO days_fts(days_fts, rowid, diary) VALUES ('delete', old.rowid, old.diary);
END;

CREATE TRIGGER days_au AFTER UPDATE ON days BEGIN
  INSERT INTO days_fts(days_fts, rowid, diary) VALUES ('delete', old.rowid, old.diary);
  INSERT INTO days_fts(rowid, diary) VALUES (new.rowid, new.diary);
END;

CREATE VIRTUAL TABLE tracker_fts USING fts5(
  note,
  content='tracker_logs',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER tracker_logs_ai AFTER INSERT ON tracker_logs BEGIN
  INSERT INTO tracker_fts(rowid, note) VALUES (new.rowid, new.note);
END;

CREATE TRIGGER tracker_logs_ad AFTER DELETE ON tracker_logs BEGIN
  INSERT INTO tracker_fts(tracker_fts, rowid, note) VALUES ('delete', old.rowid, old.note);
END;

CREATE TRIGGER tracker_logs_au AFTER UPDATE ON tracker_logs BEGIN
  INSERT INTO tracker_fts(tracker_fts, rowid, note) VALUES ('delete', old.rowid, old.note);
  INSERT INTO tracker_fts(rowid, note) VALUES (new.rowid, new.note);
END;

INSERT INTO tasks_fts(rowid, title, notes)
SELECT rowid, title, notes FROM tasks WHERE deleted_at IS NULL;

INSERT INTO days_fts(rowid, diary)
SELECT rowid, diary FROM days;

INSERT INTO tracker_fts(rowid, note)
SELECT rowid, note FROM tracker_logs;
