mod attachments;
mod backup;
mod tray;

use std::path::PathBuf;
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition};
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderOpen {
    task_id: Option<String>,
}

#[derive(serde::Serialize)]
struct DatabaseFile {
    path: String,
    exists: bool,
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("{}: {err}", dir.display()))?;
    Ok(dir)
}

#[tauri::command]
fn database_file(app: tauri::AppHandle) -> Result<DatabaseFile, String> {
    let path = config_dir(&app)?.join("layp.db");
    Ok(DatabaseFile {
        exists: path.is_file(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn export_backup(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let dir = config_dir(&app)?;
    backup::export_files(&dir, std::path::Path::new(&folder), &backup::exported_now()).map_err(|err| {
        log::error!("export failed");
        err
    })
}

#[tauri::command]
fn export_zip(app: tauri::AppHandle, destination: String) -> Result<(), String> {
    let dir = config_dir(&app)?;
    backup::export_zip(&dir, std::path::Path::new(&destination), &backup::exported_now()).map_err(|err| {
        log::error!("export failed");
        err
    })
}

#[tauri::command]
fn check_backup(source: String) -> Result<(), String> {
    let path = std::path::Path::new(&source);
    if backup::is_zip_path(path) {
        return backup::validate_zip(path);
    }
    let resolved = backup::resolve_source(path)?;
    backup::validate_backup(&resolved)
}

#[tauri::command]
fn import_backup(app: tauri::AppHandle, source: String) -> Result<(), String> {
    let dir = config_dir(&app)?;
    let path = std::path::Path::new(&source);
    if backup::is_zip_path(path) {
        let staging = dir.join("layp.zip.import");
        let _ = std::fs::remove_dir_all(&staging);
        let resolved = backup::extract_zip(path, &staging).map_err(|err| {
            log::error!("import failed");
            let _ = std::fs::remove_dir_all(&staging);
            err
        })?;
        let result = backup::swap_database(&dir, &resolved).map_err(|err| {
            log::error!("import failed");
            err
        });
        let _ = std::fs::remove_dir_all(&staging);
        return result;
    }
    let resolved = backup::resolve_source(path).map_err(|err| {
        log::error!("import failed");
        err
    })?;
    backup::swap_database(&dir, &resolved).map_err(|err| {
        log::error!("import failed");
        err
    })
}

#[tauri::command]
fn copy_attachment(app: tauri::AppHandle, source: String, id: String) -> Result<u64, String> {
    let root = config_dir(&app)?;
    attachments::store_attachment(&root, std::path::Path::new(&source), &id).map_err(|err| {
        log::error!("attachment failed");
        err
    })
}

#[tauri::command]
fn open_attachment(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = config_dir(&app)?;
    let path = attachments::attachment_path(&root, &id).map_err(|message| message.to_string())?;
    if !path.is_file() {
        return Err("File missing".to_string());
    }
    let spawn = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd").args(["/C", "start", "", &path.to_string_lossy()]).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&path).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(&path).spawn()
    };
    spawn.map_err(|_| {
        log::error!("attachment failed");
        "That file could not be opened.".to_string()
    })?;
    Ok(())
}

#[tauri::command]
fn delete_attachment_files(app: tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
    let root = config_dir(&app)?;
    attachments::remove_attachment_files(&root, &ids).map_err(|err| {
        log::error!("attachment failed");
        err
    })
}

#[tauri::command]
fn present_attachment_ids(app: tauri::AppHandle, ids: Vec<String>) -> Result<Vec<String>, String> {
    let root = config_dir(&app)?;
    Ok(attachments::present_attachment_ids(&root, &ids))
}

#[tauri::command]
fn sweep_attachments(app: tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
    let root = config_dir(&app)?;
    let live = ids.into_iter().collect();
    attachments::sweep_attachment_files(&root, &live).map_err(|err| {
        log::error!("attachment failed");
        err
    })
}

#[tauri::command]
fn show_database_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = config_dir(&app)?;
    open_dir(&dir)
}

#[tauri::command]
fn show_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|_| "The log folder could not be opened.".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("Could not open {}. {err}", dir.display()))?;
    open_dir(&dir)
}

#[tauri::command]
fn set_tray_timer(app: tauri::AppHandle, active: bool, running: bool) -> Result<(), String> {
    tray::set_timer(&app, tray::TrayTimer { active, running })
}

#[tauri::command]
fn ensure_on_screen(window: tauri::WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|err| err.to_string())?;
    let size = window.outer_size().map_err(|err| err.to_string())?;
    let monitors = window.available_monitors().map_err(|err| err.to_string())?;
    let on_screen = monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let bounds = monitor.size();
        let left = origin.x;
        let top = origin.y;
        let right = left + bounds.width as i32;
        let bottom = top + bounds.height as i32;
        [
            (position.x, position.y),
            (position.x + size.width as i32, position.y),
            (position.x, position.y + size.height as i32),
            (position.x + size.width as i32, position.y + size.height as i32),
        ]
        .into_iter()
        .any(|(x, y)| x >= left && x < right && y >= top && y < bottom)
    });
    if on_screen {
        return Ok(());
    }
    let Some(primary) = window.primary_monitor().map_err(|err| err.to_string())? else {
        return Ok(());
    };
    let bounds = primary.size();
    let scale = primary.scale_factor();
    let width = 1280.0_f64.min(bounds.width as f64 / scale);
    let height = 800.0_f64.min(bounds.height as f64 / scale);
    window.set_size(LogicalSize::new(width, height)).map_err(|err| err.to_string())?;
    let x = primary.position().x + (bounds.width as i32 - (width * scale) as i32) / 2;
    let y = primary.position().y + (bounds.height as i32 - (height * scale) as i32) / 2;
    window.set_position(PhysicalPosition::new(x, y)).map_err(|err| err.to_string())?;
    let _ = window.unmaximize();
    Ok(())
}

fn open_dir(path: &std::path::Path) -> Result<(), String> {
    let spawn = if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg(path).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(path).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(path).spawn()
    };
    spawn
        .map(|_| ())
        .map_err(|err| format!("Could not open {}. {err}", path.display()))
}

#[tauri::command]
fn show_reminder(app: tauri::AppHandle, title: String, body: String, task_id: Option<String>) -> Result<(), String> {
    let mut note = notify_rust::Notification::new();
    note.summary(&clip(&title))
        .body(&clip(&body))
        .appname("Layp")
        .timeout(notify_rust::Timeout::Milliseconds(12_000));

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        note.action("default", "Show");
        let handle = note.show().map_err(|_| "reminder failed".to_string())?;
        let app_handle = app.clone();
        std::thread::spawn(move || {
            handle.wait_for_action(move |action| {
                if action == "default" {
                    open_from_toast(&app_handle, task_id);
                }
            });
        });
        return Ok(());
    }

    #[cfg(not(all(unix, not(target_os = "macos"))))]
    {
        let _ = (app, task_id);
        note.show().map_err(|_| "reminder failed".to_string())?;
        Ok(())
    }
}

fn open_from_toast(app: &tauri::AppHandle, task_id: Option<String>) {
    let _ = app.emit("reminder-open", ReminderOpen { task_id });
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn clip(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars().take(180) {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    if out.trim().is_empty() { "Layp".to_string() } else { out }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "schema_v1",
            sql: include_str!("../migrations/001_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "checklist_reminders",
            sql: include_str!("../migrations/002_checklist_reminders.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "attachments",
            sql: include_str!("../migrations/003_attachments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "fts",
            sql: include_str!("../migrations/004_fts.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|arg| arg == "--quick-add") {
                tray::quick_add(app);
            } else {
                tray::show_main(app);
            }
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:layp.db", migrations)
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .setup(|app| {
            tray::setup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database_file,
            show_reminder,
            export_backup,
            export_zip,
            check_backup,
            import_backup,
            copy_attachment,
            open_attachment,
            delete_attachment_files,
            present_attachment_ids,
            sweep_attachments,
            show_database_folder,
            show_log_folder,
            set_tray_timer,
            ensure_on_screen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Layp");
}

#[cfg(test)]
mod fts_tests {
    use std::io::Write;
    use std::process::{Command, Stdio};

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
            "sqlite failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }

    #[test]
    fn title_ranks_above_buried_notes_and_deleted_rows_drop_out() {
        let dir = std::env::temp_dir().join(format!("layp-fts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("layp.db");
        let buried = format!("words {}", "padding ".repeat(400));
        let mut setup = String::from(
            "CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE tasks (
               id TEXT PRIMARY KEY,
               list_id TEXT NOT NULL,
               title TEXT NOT NULL,
               notes TEXT NOT NULL DEFAULT '',
               deleted_at TEXT NULL
             );
             CREATE TABLE days (day TEXT PRIMARY KEY, diary TEXT NOT NULL DEFAULT '');
             CREATE TABLE tracker_logs (
               id TEXT PRIMARY KEY,
               day TEXT NOT NULL,
               note TEXT NOT NULL DEFAULT ''
             );",
        );
        setup.push_str(include_str!("../migrations/004_fts.sql"));
        setup.push_str(&format!(
            "INSERT INTO lists (id, name) VALUES ('inbox', 'Inbox');
             INSERT INTO tasks (id, list_id, title, notes, deleted_at) VALUES
               ('title-hit', 'inbox', 'Zebraunique', 'short', NULL),
               ('notes-hit', 'inbox', 'other task', '{buried} zebraunique', NULL),
               ('literal', 'inbox', '100%_done', 'plain', NULL),
               ('wildcard', 'inbox', '100X_done', 'plain', NULL),
               ('trashed', 'inbox', 'Zebraunique extra', 'short', '2020-01-01');
             INSERT INTO days (day, diary) VALUES ('2026-01-02', 'diary zebraunique');
             INSERT INTO tracker_logs (id, day, note) VALUES ('log', '2026-01-02', 'tracker zebraunique');"
        ));
        sqlite(&db, &setup);

        let rank = "SELECT t.id FROM tasks_fts
            JOIN tasks t ON t.rowid = tasks_fts.rowid
            JOIN lists l ON l.id = t.list_id
            WHERE tasks_fts MATCH '\"zebraunique\"*' AND t.deleted_at IS NULL
            ORDER BY bm25(tasks_fts, 8.0, 1.0);";
        let before_text = sqlite(&db, rank);
        let before: Vec<&str> = before_text.lines().collect();
        assert_eq!(before.first().copied(), Some("title-hit"));
        assert!(before.contains(&"notes-hit"));
        assert!(!before.contains(&"trashed"));

        sqlite(&db, "UPDATE tasks SET deleted_at = 'now' WHERE id = 'title-hit';");
        let after = sqlite(&db, rank);
        assert!(!after.lines().any(|line| line == "title-hit"));
        assert!(after.lines().any(|line| line == "notes-hit"));

        let literal = sqlite(
            &db,
            "SELECT t.id FROM tasks_fts JOIN tasks t ON t.rowid = tasks_fts.rowid
             WHERE tasks_fts MATCH '\"100%_done\"*' ORDER BY t.id;",
        );
        assert_eq!(literal.trim(), "literal");

        let days = sqlite(
            &db,
            "SELECT day, kind, rank FROM (
               SELECT d.day AS day, 'diary' AS kind, bm25(days_fts) AS rank
               FROM days_fts JOIN days d ON d.rowid = days_fts.rowid
               WHERE days_fts MATCH '\"zebraunique\"*'
               ORDER BY rank LIMIT 50
             )
             UNION ALL
             SELECT day, kind, rank FROM (
               SELECT t.day AS day, 'tracker' AS kind, bm25(tracker_fts) AS rank
               FROM tracker_fts JOIN tracker_logs t ON t.rowid = tracker_fts.rowid
               WHERE tracker_fts MATCH '\"zebraunique\"*'
               ORDER BY rank LIMIT 50
             );",
        );
        assert!(days.lines().any(|line| line.starts_with("2026-01-02|diary|")));
        assert!(days.lines().any(|line| line.starts_with("2026-01-02|tracker|")));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
