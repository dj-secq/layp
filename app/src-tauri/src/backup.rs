use serde_json::Value;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const SCHEMA_VERSION: u64 = 4;
const MAX_BACKUP_BYTES: u64 = 512 * 1024 * 1024;

pub struct BackupSource {
    pub database: PathBuf,
    pub manifest: Option<PathBuf>,
}

pub fn resolve_source(path: &Path) -> Result<BackupSource, String> {
    if path.is_dir() {
        let database = path.join("layp.db");
        if !database.is_file() {
            return Err(format!(
                "Import failed for {}. That folder has no layp.db. The current database was left in place.",
                path.display()
            ));
        }
        let manifest = path.join("manifest.json");
        return Ok(BackupSource {
            database,
            manifest: manifest.is_file().then_some(manifest),
        });
    }
    if path.is_file() {
        let manifest = path
            .parent()
            .map(|parent| parent.join("manifest.json"))
            .filter(|candidate| candidate.is_file());
        return Ok(BackupSource {
            database: path.to_path_buf(),
            manifest,
        });
    }
    Err(format!(
        "Import failed for {}. That path is not there. The current database was left in place.",
        path.display()
    ))
}

pub fn validate_backup(source: &BackupSource) -> Result<(), String> {
    if let Some(manifest) = &source.manifest {
        let bytes = fs::read(manifest).map_err(|err| {
            format!(
                "Import failed for {}. {}. The current database was left in place.",
                manifest.display(),
                err
            )
        })?;
        if let Err(message) = check_manifest(&bytes) {
            return Err(format!(
                "{message} {}",
                manifest.display()
            ));
        }
    }
    if let Err(message) = looks_like_layp(&source.database) {
        return Err(format!(
            "{message} {}",
            source.database.display()
        ));
    }
    Ok(())
}

pub fn check_manifest(bytes: &[u8]) -> Result<(), &'static str> {
    let value: Value = match serde_json::from_slice(bytes) {
        Ok(value) => value,
        Err(_) => return Err("That file is not a Layp database."),
    };
    if value.get("app").and_then(Value::as_str) != Some("Layp") {
        return Err("That file is not a Layp database.");
    }
    let version = value.get("schema_version").and_then(Value::as_u64).unwrap_or(0);
    if version > SCHEMA_VERSION {
        return Err("That backup is from a newer Layp.");
    }
    if version == 0 {
        return Err("That file is not a Layp database.");
    }
    Ok(())
}

pub fn looks_like_layp(path: &Path) -> Result<(), &'static str> {
    let meta = fs::metadata(path).map_err(|_| "That file is not a Layp database.")?;
    if meta.len() < 16 || meta.len() > MAX_BACKUP_BYTES {
        return Err("That file is not a Layp database.");
    }
    let mut file = File::open(path).map_err(|_| "That file is not a Layp database.")?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|_| "That file is not a Layp database.")?;
    looks_like_layp_bytes(&bytes)
}

fn looks_like_layp_bytes(bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() < 16 || bytes.len() as u64 > MAX_BACKUP_BYTES {
        return Err("That file is not a Layp database.");
    }
    if &bytes[..16] != b"SQLite format 3\0" {
        return Err("That file is not a Layp database.");
    }
    let marker = b"CREATE TABLE tasks";
    if bytes.windows(marker.len()).any(|window| window == marker) {
        Ok(())
    } else {
        Err("That file is not a Layp database.")
    }
}

pub fn is_zip_path(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
}

struct ZipPayload {
    manifest: Vec<u8>,
    database: Vec<u8>,
    attachments: Vec<(String, Vec<u8>)>,
}

enum ZipName {
    Manifest,
    Database,
    Attachment(String),
    Directory,
}

fn classify_zip_name(name: &str) -> Result<ZipName, &'static str> {
    if name.is_empty() || name.starts_with('/') || name.starts_with('\\') || name.contains('\\') || name.contains('\0') {
        return Err("That file is not a Layp database.");
    }
    let directory = name.ends_with('/');
    let trimmed = name.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("That file is not a Layp database.");
    }
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.iter().any(|part| part.is_empty() || *part == "." || *part == "..") {
        return Err("That file is not a Layp database.");
    }
    if directory {
        return if parts == ["attachments"] {
            Ok(ZipName::Directory)
        } else {
            Err("That file is not a Layp database.")
        };
    }
    match parts.as_slice() {
        ["manifest.json"] => Ok(ZipName::Manifest),
        ["layp.db"] => Ok(ZipName::Database),
        ["attachments", id] => Ok(ZipName::Attachment((*id).to_string())),
        _ => Err("That file is not a Layp database."),
    }
}

fn read_capped(reader: &mut impl Read, remaining: &mut u64) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let read = reader.read(&mut buf).map_err(|_| "That file is not a Layp database.")?;
        if read == 0 {
            break;
        }
        if read as u64 > *remaining {
            return Err("That backup is larger than 512 MB.");
        }
        *remaining -= read as u64;
        out.extend_from_slice(&buf[..read]);
    }
    Ok(out)
}

fn zip_error(path: &Path, message: impl std::fmt::Display) -> String {
    format!("{message} {}", path.display())
}

fn read_zip_payload(path: &Path) -> Result<ZipPayload, String> {
    let file = File::open(path).map_err(|err| zip_error(path, err))?;
    let mut archive = ZipArchive::new(file).map_err(|_| zip_error(path, "That file is not a Layp database."))?;
    let mut manifest = None;
    let mut database = None;
    let mut attachments = Vec::new();
    let mut remaining = MAX_BACKUP_BYTES;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| zip_error(path, "That file is not a Layp database."))?;
        let name = entry.name().to_string();
        let kind = classify_zip_name(&name).map_err(|message| zip_error(path, message))?;
        if matches!(kind, ZipName::Directory) {
            continue;
        }
        let bytes = read_capped(&mut entry, &mut remaining).map_err(|message| zip_error(path, message))?;
        match kind {
            ZipName::Manifest => {
                if manifest.is_some() {
                    return Err(zip_error(path, "That file is not a Layp database."));
                }
                manifest = Some(bytes);
            }
            ZipName::Database => {
                if database.is_some() {
                    return Err(zip_error(path, "That file is not a Layp database."));
                }
                database = Some(bytes);
            }
            ZipName::Attachment(id) => {
                if attachments.iter().any(|(existing, _)| existing == &id) {
                    return Err(zip_error(path, "That file is not a Layp database."));
                }
                attachments.push((id, bytes));
            }
            ZipName::Directory => {}
        }
    }
    let manifest = manifest.ok_or_else(|| zip_error(path, "That file is not a Layp database."))?;
    let database = database.ok_or_else(|| zip_error(path, "That file is not a Layp database."))?;
    Ok(ZipPayload { manifest, database, attachments })
}

pub fn validate_zip(path: &Path) -> Result<(), String> {
    let payload = read_zip_payload(path)?;
    check_manifest(&payload.manifest).map_err(|message| zip_error(path, message))?;
    looks_like_layp_bytes(&payload.database).map_err(|message| zip_error(path, message))?;
    Ok(())
}

pub fn extract_zip(path: &Path, dest: &Path) -> Result<BackupSource, String> {
    let payload = read_zip_payload(path)?;
    check_manifest(&payload.manifest).map_err(|message| zip_error(path, message))?;
    looks_like_layp_bytes(&payload.database).map_err(|message| zip_error(path, message))?;
    fs::create_dir_all(dest).map_err(|err| zip_error(path, err))?;
    let database = dest.join("layp.db");
    let manifest = dest.join("manifest.json");
    fs::write(&database, &payload.database).map_err(|err| zip_error(path, err))?;
    fs::write(&manifest, &payload.manifest).map_err(|err| zip_error(path, err))?;
    if !payload.attachments.is_empty() {
        let folder = dest.join("attachments");
        fs::create_dir_all(&folder).map_err(|err| zip_error(path, err))?;
        for (id, bytes) in payload.attachments {
            fs::write(folder.join(id), bytes).map_err(|err| zip_error(path, err))?;
        }
    }
    Ok(BackupSource { database, manifest: Some(manifest) })
}

pub fn export_zip(dir: &Path, destination: &Path, exported_at: &str) -> Result<(), String> {
    let parent = destination.parent().filter(|parent| parent.as_os_str().is_empty() || parent.is_dir());
    if parent.is_none() {
        return Err(format!("Export failed for {}. Choose a folder.", destination.display()));
    }
    let live = dir.join("layp.db");
    if !live.is_file() {
        return Err(format!("Export failed for {}. The database file is not there yet.", live.display()));
    }
    if wal_is_busy(dir) {
        return Err(format!("Export failed for {}. The database was still writing.", destination.display()));
    }
    let database = fs::read(&live).map_err(|err| format!("Export failed for {}. {err}", destination.display()))?;
    if database.len() as u64 > MAX_BACKUP_BYTES {
        return Err(format!("Export failed for {}. That backup is larger than 512 MB.", destination.display()));
    }
    if let Err(message) = looks_like_layp_bytes(&database) {
        return Err(format!("Export failed for {}. {message}", destination.display()));
    }
    let manifest = serde_json::json!({
        "app": "Layp",
        "schema_version": SCHEMA_VERSION,
        "exported_at": exported_at,
    });
    let body = serde_json::to_vec_pretty(&manifest).map_err(|err| format!("Export failed for {}. {err}", destination.display()))?;
    let mut budget = MAX_BACKUP_BYTES.saturating_sub(database.len() as u64).saturating_sub(body.len() as u64);
    let stored = crate::attachments::read_stored_files(dir, &mut budget).map_err(|message| {
        format!("Export failed for {}. {message}", destination.display())
    })?;
    let file = File::create(destination).map_err(|err| format!("Export failed for {}. {err}", destination.display()))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let failed = (|| {
        zip.start_file("manifest.json", options).map_err(|err| err.to_string())?;
        zip.write_all(&body).map_err(|err| err.to_string())?;
        zip.start_file("layp.db", options).map_err(|err| err.to_string())?;
        zip.write_all(&database).map_err(|err| err.to_string())?;
        for item in &stored {
            zip.start_file(format!("attachments/{}", item.name), options).map_err(|err| err.to_string())?;
            zip.write_all(&item.bytes).map_err(|err| err.to_string())?;
        }
        zip.finish().map_err(|err| err.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(err) = failed {
        let _ = fs::remove_file(destination);
        return Err(format!("Export failed for {}. {err}", destination.display()));
    }
    let _ = fs::remove_file(dir.join("layp.db.replaced"));
    let _ = fs::remove_file(dir.join("layp.db.replaced-wal"));
    let _ = fs::remove_file(dir.join("layp.db.replaced-shm"));
    Ok(())
}

pub fn wal_is_busy(dir: &Path) -> bool {
    fs::metadata(dir.join("layp.db-wal")).map(|meta| meta.len() > 32).unwrap_or(false)
}

pub fn export_files(dir: &Path, folder: &Path, exported_at: &str) -> Result<(), String> {
    if !folder.is_dir() {
        return Err(format!("Export failed for {}. Choose a folder.", folder.display()));
    }
    let live = dir.join("layp.db");
    if !live.is_file() {
        return Err(format!(
            "Export failed for {}. The database file is not there yet.",
            live.display()
        ));
    }
    if wal_is_busy(dir) {
        return Err(format!(
            "Export failed for {}. The database was still writing.",
            folder.display()
        ));
    }
    let target = folder.join("layp.db");
    fs::copy(&live, &target).map_err(|err| format!("Export failed for {}. {err}", folder.display()))?;
    let manifest = serde_json::json!({
        "app": "Layp",
        "schema_version": SCHEMA_VERSION,
        "exported_at": exported_at,
    });
    let body = serde_json::to_vec_pretty(&manifest).map_err(|err| format!("Export failed for {}. {err}", folder.display()))?;
    fs::write(folder.join("manifest.json"), body).map_err(|err| format!("Export failed for {}. {err}", folder.display()))?;
    crate::attachments::copy_attachment_dir(dir, folder).map_err(|err| format!("Export failed for {}. {err}", folder.display()))?;
    let _ = fs::remove_file(dir.join("layp.db.replaced"));
    let _ = fs::remove_file(dir.join("layp.db.replaced-wal"));
    let _ = fs::remove_file(dir.join("layp.db.replaced-shm"));
    Ok(())
}

pub fn swap_database(dir: &Path, source: &BackupSource) -> Result<(), String> {
    validate_backup(source)?;
    if wal_is_busy(dir) {
        return Err(format!(
            "Import failed for {}. The database was still writing. The current database was left in place.",
            source.database.display()
        ));
    }
    let live = dir.join("layp.db");
    let incoming = dir.join("layp.db.import");
    let replaced = dir.join("layp.db.replaced");
    let wal = dir.join("layp.db-wal");
    let shm = dir.join("layp.db-shm");
    let replaced_wal = dir.join("layp.db.replaced-wal");
    let replaced_shm = dir.join("layp.db.replaced-shm");

    fs::copy(&source.database, &incoming).map_err(|err| {
        format!(
            "Import failed for {}. {err} The current database was left in place.",
            source.database.display()
        )
    })?;
    if let Err(err) = looks_like_layp(&incoming) {
        let _ = fs::remove_file(&incoming);
        return Err(format!("{err} {}", source.database.display()));
    }

    let _ = fs::remove_file(&replaced);
    let _ = fs::remove_file(&replaced_wal);
    let _ = fs::remove_file(&replaced_shm);
    let had_wal = wal.is_file();
    let had_shm = shm.is_file();
    if had_wal {
        fs::rename(&wal, &replaced_wal).map_err(|err| import_left(source, err))?;
    }
    if had_shm {
        if let Err(err) = fs::rename(&shm, &replaced_shm) {
            if had_wal {
                let _ = fs::rename(&replaced_wal, &wal);
            }
            return Err(import_left(source, err));
        }
    }
    let had_live = live.is_file();
    if had_live {
        if let Err(err) = fs::rename(&live, &replaced) {
            restore_sidecars(had_wal, had_shm, &wal, &shm, &replaced_wal, &replaced_shm);
            let _ = fs::remove_file(&incoming);
            return Err(import_left(source, err));
        }
    }
    if let Err(err) = fs::rename(&incoming, &live) {
        if had_live {
            let _ = fs::rename(&replaced, &live);
        }
        restore_sidecars(had_wal, had_shm, &wal, &shm, &replaced_wal, &replaced_shm);
        let _ = fs::remove_file(&incoming);
        return Err(import_left(source, err));
    }
    if let Some(parent) = source.database.parent() {
        if let Err(err) = crate::attachments::copy_attachment_dir(parent, dir) {
            return Err(import_left(source, err));
        }
    }
    Ok(())
}

fn import_left(source: &BackupSource, err: impl std::fmt::Display) -> String {
    format!(
        "Import failed for {}. {err} The current database was left in place.",
        source.database.display()
    )
}

fn restore_sidecars(had_wal: bool, had_shm: bool, wal: &Path, shm: &Path, replaced_wal: &Path, replaced_shm: &Path) {
    if had_wal {
        let _ = fs::rename(replaced_wal, wal);
    }
    if had_shm {
        let _ = fs::rename(replaced_shm, shm);
    }
}

pub fn exported_now() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    unix_to_iso(secs)
}

pub fn unix_to_iso(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z",
        hour = rem / 3600,
        minute = (rem % 3600) / 60,
        second = rem % 60
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = (if month <= 2 { y + 1 } else { y }) as i32;
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_epoch_and_known_day() {
        assert_eq!(unix_to_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(unix_to_iso(946_684_800), "2000-01-01T00:00:00Z");
        assert_eq!(unix_to_iso(1_791_072_000), "2026-10-04T00:00:00Z");
    }

    #[test]
    fn manifest_accepts_this_schema_only() {
        let current = format!(r#"{{"app":"Layp","schema_version":{SCHEMA_VERSION}}}"#);
        let newer = format!(r#"{{"app":"Layp","schema_version":{}}}"#, SCHEMA_VERSION + 1);
        assert!(check_manifest(current.as_bytes()).is_ok());
        assert_eq!(check_manifest(newer.as_bytes()), Err("That backup is from a newer Layp."));
        assert!(check_manifest(br#"{"app":"Other","schema_version":1}"#).is_err());
        assert!(check_manifest(b"not json").is_err());
    }

    fn sample_database() -> Vec<u8> {
        let mut bytes = b"SQLite format 3\0".to_vec();
        bytes.extend_from_slice(&[0u8; 32]);
        bytes.extend_from_slice(b"CREATE TABLE tasks");
        bytes
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn zip_round_trip_keeps_the_database_and_an_attachment() {
        let dir = std::env::temp_dir().join(format!("layp-zip-round-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let database = sample_database();
        fs::write(dir.join("layp.db"), &database).unwrap();
        let destination = dir.join("backup.zip");
        export_zip(&dir, &destination, "2026-10-04T00:00:00Z").unwrap();
        validate_zip(&destination).unwrap();
        let staging = dir.join("out");
        let source = extract_zip(&destination, &staging).unwrap();
        let restored = fs::read(&source.database).unwrap();
        assert_eq!(restored, database);
        let manifest = fs::read(source.manifest.unwrap()).unwrap();
        check_manifest(&manifest).unwrap();
        let mut names = ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        let mut found = Vec::new();
        for index in 0..names.len() {
            found.push(names.by_index(index).unwrap().name().to_string());
        }
        found.sort();
        assert_eq!(found, vec!["layp.db".to_string(), "manifest.json".to_string()]);
        fs::create_dir_all(dir.join("attachments")).unwrap();
        fs::write(dir.join("attachments").join("note.txt"), b"hello").unwrap();
        let with_export = dir.join("exported-file.zip");
        export_zip(&dir, &with_export, "2026-10-04T00:00:00Z").unwrap();
        let exported = dir.join("exported");
        extract_zip(&with_export, &exported).unwrap();
        assert_eq!(fs::read(exported.join("attachments").join("note.txt")).unwrap(), b"hello");
        let with_file = dir.join("with-file.zip");
        let manifest_body = format!(r#"{{"app":"Layp","schema_version":{SCHEMA_VERSION}}}"#);
        write_zip(
            &with_file,
            &[
                ("manifest.json", manifest_body.as_bytes()),
                ("layp.db", database.as_slice()),
                ("attachments/note.txt", b"hello"),
            ],
        );
        let staged = dir.join("files");
        extract_zip(&with_file, &staged).unwrap();
        assert_eq!(fs::read(staged.join("attachments").join("note.txt")).unwrap(), b"hello");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn zip_rejects_escape_and_a_newer_schema() {
        let dir = std::env::temp_dir().join(format!("layp-zip-bad-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let database = sample_database();
        let manifest = format!(r#"{{"app":"Layp","schema_version":{SCHEMA_VERSION}}}"#);
        let newer = format!(r#"{{"app":"Layp","schema_version":{}}}"#, SCHEMA_VERSION + 1);
        let escaped = dir.join("escape.zip");
        write_zip(&escaped, &[("../layp.db", database.as_slice()), ("manifest.json", manifest.as_bytes())]);
        assert!(validate_zip(&escaped).is_err());
        let nested = dir.join("nested.zip");
        write_zip(&nested, &[("attachments/nested/file", b"x"), ("layp.db", database.as_slice()), ("manifest.json", manifest.as_bytes())]);
        assert!(validate_zip(&nested).is_err());
        let ahead = dir.join("ahead.zip");
        write_zip(&ahead, &[("layp.db", database.as_slice()), ("manifest.json", newer.as_bytes())]);
        let message = validate_zip(&ahead).unwrap_err();
        assert!(message.contains("newer Layp"), "{message}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sqlite_without_tasks_is_rejected() {
        let dir = std::env::temp_dir().join(format!("layp-backup-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("plain.db");
        let mut bytes = b"SQLite format 3\0".to_vec();
        bytes.extend_from_slice(&[0u8; 32]);
        bytes.extend_from_slice(b"CREATE TABLE notes");
        fs::write(&path, &bytes).unwrap();
        assert!(looks_like_layp(&path).is_err());
        bytes.extend_from_slice(b"CREATE TABLE tasks");
        fs::write(&path, &bytes).unwrap();
        assert!(looks_like_layp(&path).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }
}
