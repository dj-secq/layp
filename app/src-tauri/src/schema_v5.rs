#[cfg(test)]
mod tests {
    use crate::db_tx::now_iso;
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn temp_db(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "layp-{label}-{}-{}.db",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    fn sqlite(db: &std::path::Path, sql: &str) -> String {
        let mut child = Command::new("sqlite3")
            .arg(db)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("sqlite3");
        child.stdin.take().unwrap().write_all(sql.as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "sqlite failed: {}\n{sql}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }

    fn apply_through_v4(db: &std::path::Path) {
        let mut sql = String::new();
        sql.push_str(include_str!("../migrations/001_schema.sql"));
        sql.push_str(include_str!("../migrations/002_checklist_reminders.sql"));
        sql.push_str(include_str!("../migrations/003_attachments.sql"));
        sql.push_str(include_str!("../migrations/004_fts.sql"));
        sqlite(db, &sql);
    }

    fn apply_v5(db: &std::path::Path) {
        sqlite(db, include_str!("../migrations/005_phone.sql"));
    }

    #[test]
    fn schema_v5_backfills_stamps_and_syncs_a_section_with_two_tags() {
        let db = temp_db("v5");
        apply_through_v4(&db);
        sqlite(
            &db,
            "INSERT INTO tasks (
               id, series_id, list_id, section_id, title, sort_order, created_at, updated_at
             ) VALUES (
               'pre-task', 'pre-task', 'inbox', 'inbox-open', 'Pre', 1,
               '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
             );
             INSERT INTO tags (id, name, color, created_at)
               VALUES ('pre-tag', 'Pre', '#ffdc58', '2026-09-02T00:00:00.000Z');
             INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at)
               VALUES ('pre-rem', 'pre-task', 10, NULL, '2026-09-03T00:00:00.000Z');
             INSERT INTO countdowns (id, title, target_on, sort_order, created_at)
               VALUES ('pre-count', 'Trip', '2026-12-25', 0, '2026-09-05T00:00:00.000Z');
             INSERT INTO checklist_reminders (
               id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at
             ) VALUES (
               'pre-check', 'pre-task', 'line', '2026-09-04', NULL, 5, NULL, '2026-09-04T00:00:00.000Z'
             );",
        );
        apply_v5(&db);

        let copied = sqlite(
            &db,
            "SELECT
               (SELECT updated_at = created_at FROM tags WHERE id = 'pre-tag'),
               (SELECT updated_at = created_at FROM reminders WHERE id = 'pre-rem'),
               (SELECT updated_at = created_at FROM checklist_reminders WHERE id = 'pre-check'),
               (SELECT updated_at = created_at FROM countdowns WHERE id = 'pre-count');",
        );
        assert_eq!(copied.trim(), "1|1|1|1");

        let visible = sqlite(
            &db,
            "SELECT
               (SELECT COUNT(*) FROM tags WHERE id = 'pre-tag' AND updated_at > ''),
               (SELECT COUNT(*) FROM reminders WHERE id = 'pre-rem' AND updated_at > ''),
               (SELECT COUNT(*) FROM checklist_reminders WHERE id = 'pre-check' AND updated_at > ''),
               (SELECT COUNT(*) FROM countdowns WHERE id = 'pre-count' AND updated_at > '');",
        );
        assert_eq!(visible.trim(), "1|1|1|1");

        let section = sqlite(
            &db,
            "SELECT updated_at,
                    updated_at > '',
                    updated_at > '2026-10-08T00:00:00.000Z'
             FROM sections WHERE id = 'inbox-open';",
        );
        assert_eq!(section.trim(), "2026-10-08T00:00:00.000Z|1|0");

        assert_eq!(
            sqlite(&db, "SELECT value FROM settings WHERE key = 'phone_link';").trim(),
            "off"
        );
        assert_eq!(
            sqlite(&db, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'deletions';").trim(),
            "1"
        );
        sqlite(
            &db,
            "INSERT INTO paired_phone (id, name, key_hash, paired_at)
             VALUES ('phone', 'Phone', 'hash', '2026-10-08T00:00:00.000Z');",
        );
        assert_eq!(
            sqlite(&db, "SELECT have_at, have_id, ack_at, ack_id FROM paired_phone;").trim(),
            "|||"
        );

        sqlite(
            &db,
            "INSERT INTO lists (
               id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at
             ) VALUES (
               'list-west', NULL, 'West', '#5b8def', 1, NULL, 0,
               '2026-10-08T02:00:00.000Z', '2026-10-08T02:00:00.000Z'
             );
             INSERT INTO sections (id, list_id, name, sort_order, updated_at)
               VALUES ('sec-west', 'list-west', 'Alpha', 0, '2026-10-08T02:00:00.001Z');
             INSERT INTO tags (id, name, color, created_at, updated_at) VALUES
               ('tag-red', 'Red', '#ff6b6b', '2026-10-08T02:00:00.002Z', '2026-10-08T02:00:00.002Z'),
               ('tag-blue', 'Blue', '#5b8def', '2026-10-08T02:00:00.003Z', '2026-10-08T02:00:00.003Z');
             INSERT INTO tasks (
               id, series_id, list_id, section_id, title, sort_order, created_at, updated_at
             ) VALUES (
               'task-west', 'task-west', 'list-west', 'sec-west', 'Both tags', 1,
               '2026-10-08T02:00:00.004Z', '2026-10-08T02:00:00.004Z'
             );
             INSERT INTO task_tags (task_id, tag_id) VALUES
               ('task-west', 'tag-red'),
               ('task-west', 'tag-blue');",
        );

        let since = "updated_at > '' OR (updated_at = '' AND id > '')";
        let sections = sqlite(&db, &format!("SELECT id FROM sections WHERE {since} ORDER BY id;"));
        assert!(sections.lines().any(|id| id == "sec-west"), "{sections}");
        assert!(sections.lines().any(|id| id == "inbox-open"), "{sections}");
        let tags = sqlite(&db, &format!("SELECT id FROM tags WHERE {since} ORDER BY id;"));
        assert!(tags.lines().any(|id| id == "tag-red"), "{tags}");
        assert!(tags.lines().any(|id| id == "tag-blue"), "{tags}");

        let peer = temp_db("v5-peer");
        apply_through_v4(&peer);
        apply_v5(&peer);
        // The batch changesSince would send: list, section, both tags, the task, and both links.
        sqlite(
            &peer,
            "PRAGMA foreign_keys = ON;
             BEGIN IMMEDIATE;
             PRAGMA defer_foreign_keys = ON;
             INSERT INTO lists (
               id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at
             ) VALUES (
               'list-west', NULL, 'West', '#5b8def', 1, NULL, 0,
               '2026-10-08T02:00:00.000Z', '2026-10-08T02:00:00.000Z'
             );
             INSERT INTO tags (id, name, color, created_at, updated_at) VALUES
               ('tag-red', 'Red', '#ff6b6b', '2026-10-08T02:00:00.002Z', '2026-10-08T02:00:00.002Z'),
               ('tag-blue', 'Blue', '#5b8def', '2026-10-08T02:00:00.003Z', '2026-10-08T02:00:00.003Z');
             INSERT INTO sections (id, list_id, name, sort_order, updated_at)
               VALUES ('sec-west', 'list-west', 'Alpha', 0, '2026-10-08T02:00:00.001Z');
             DELETE FROM task_tags WHERE task_id = 'task-west'
               AND (
                 NOT EXISTS (SELECT 1 FROM tasks WHERE id = 'task-west')
                 OR EXISTS (
                   SELECT 1 FROM tasks WHERE id = 'task-west' AND '2026-10-08T02:00:00.004Z' > updated_at
                 )
               );
             INSERT INTO task_tags (task_id, tag_id)
             SELECT 'task-west', 'tag-red'
             WHERE (
                 NOT EXISTS (SELECT 1 FROM tasks WHERE id = 'task-west')
                 OR EXISTS (
                   SELECT 1 FROM tasks WHERE id = 'task-west' AND '2026-10-08T02:00:00.004Z' > updated_at
                 )
               )
               AND EXISTS (SELECT 1 FROM tags WHERE id = 'tag-red');
             INSERT INTO task_tags (task_id, tag_id)
             SELECT 'task-west', 'tag-blue'
             WHERE (
                 NOT EXISTS (SELECT 1 FROM tasks WHERE id = 'task-west')
                 OR EXISTS (
                   SELECT 1 FROM tasks WHERE id = 'task-west' AND '2026-10-08T02:00:00.004Z' > updated_at
                 )
               )
               AND EXISTS (SELECT 1 FROM tags WHERE id = 'tag-blue');
             INSERT INTO tasks (
               id, series_id, list_id, section_id, parent_id, title, notes, priority,
               important, urgent, pinned, start_on, due_on, due_time, duration_minutes,
               recurrence_json, estimated_pomos, completed_pomos, sort_order,
               completed_at, deleted_at, created_at, updated_at
             ) VALUES (
               'task-west', 'task-west', 'list-west', 'sec-west', NULL, 'Both tags', '', 'none',
               0, 0, 0, NULL, NULL, NULL, NULL,
               NULL, NULL, 0, 1,
               NULL, NULL, '2026-10-08T02:00:00.004Z', '2026-10-08T02:00:00.004Z'
             );
             COMMIT;",
        );
        assert_eq!(
            sqlite(&peer, "SELECT section_id FROM tasks WHERE id = 'task-west';").trim(),
            "sec-west"
        );
        assert_eq!(
            sqlite(&peer, "SELECT COUNT(*) FROM task_tags WHERE task_id = 'task-west';").trim(),
            "2",
            "one surviving link is not the fixture"
        );
        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_file(&peer);
    }

    #[tokio::test]
    async fn changes_since_sees_the_row_committed_after_the_read() {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        use sqlx::{Connection, Row};

        let path = temp_db("since");
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(SqliteConnectOptions::new().filename(&path).create_if_missing(true))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE tasks (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO tasks (id, updated_at) VALUES ('a', '2020-01-01T00:00:00.000Z')")
            .execute(&pool)
            .await
            .unwrap();

        let mut holder = pool.acquire().await.unwrap();
        sqlx::query("PRAGMA busy_timeout = 5000")
            .execute(&mut *holder)
            .await
            .unwrap();
        let mut tx = holder.begin_with("BEGIN IMMEDIATE").await.unwrap();
        let seen = sqlx::query(
            "SELECT id, updated_at FROM tasks WHERE updated_at > '' OR (updated_at = '' AND id > '')",
        )
        .fetch_all(&mut *tx)
        .await
        .unwrap();
        assert_eq!(seen.len(), 1);
        let ack_at: String = seen[0].get("updated_at");
        let ack_id: String = seen[0].get("id");

        let (send, recv) = tokio::sync::oneshot::channel();
        let writer = pool.clone();
        let handle = tokio::spawn(async move {
            let mut conn = writer.acquire().await.unwrap();
            sqlx::query("PRAGMA busy_timeout = 5000")
                .execute(&mut *conn)
                .await
                .unwrap();
            let mut write_tx = conn.begin_with("BEGIN IMMEDIATE").await.unwrap();
            // The stamp is chosen after BEGIN IMMEDIATE returns, not before the wait.
            let stamp = now_iso();
            let _ = send.send(std::time::Instant::now());
            sqlx::query("INSERT INTO tasks (id, updated_at) VALUES ($1, $2)")
                .bind("b")
                .bind(stamp)
                .execute(&mut *write_tx)
                .await
                .unwrap();
            write_tx.commit().await.unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        assert!(!handle.is_finished(), "the writer should still be waiting on the read");
        let before_commit = std::time::Instant::now();
        tx.commit().await.unwrap();
        drop(holder);
        let sampled_at = recv.await.unwrap();
        assert!(
            sampled_at >= before_commit,
            "a stamp chosen before the wait can sit behind the cursor this read already closed"
        );
        handle.await.unwrap();

        sqlx::query("INSERT INTO tasks (id, updated_at) VALUES ('0', '2020-01-01T00:00:00.000Z')")
            .execute(&pool)
            .await
            .unwrap();
        let next = sqlx::query(
            "SELECT id FROM tasks WHERE updated_at > $1 OR (updated_at = $1 AND id > $2) ORDER BY id",
        )
        .bind(&ack_at)
        .bind(&ack_id)
        .fetch_all(&pool)
        .await
        .unwrap();
        let ids: Vec<String> = next.iter().map(|row| row.get("id")).collect();
        assert_eq!(ids, vec!["b".to_string()]);

        pool.close().await;
        let _ = std::fs::remove_file(path);
    }
}
