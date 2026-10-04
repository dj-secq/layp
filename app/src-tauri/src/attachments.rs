use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

pub fn size_limit_message(len: u64) -> Option<&'static str> {
    if len > MAX_ATTACHMENT_BYTES {
        Some("That file is larger than 25 MB.")
    } else {
        None
    }
}

pub fn is_attachment_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    let dash = |index: usize| bytes[index] == b'-';
    if !(dash(8) && dash(13) && dash(18) && dash(23)) {
        return false;
    }
    bytes.iter().enumerate().all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
}

/// A single backup entry name. Rejects separators and any `..` segment.
pub fn safe_leaf(name: &str) -> bool {
    if name.is_empty() || name.len() > 200 || name == "." || name == ".." || name.contains("..") {
        return false;
    }
    name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

pub fn attachment_path(root: &Path, id: &str) -> Result<PathBuf, &'static str> {
    if !is_attachment_id(id) {
        return Err("That file could not be saved.");
    }
    Ok(root.join("attachments").join(id))
}

pub fn store_attachment(root: &Path, source: &Path, id: &str) -> Result<u64, String> {
    let dest = attachment_path(root, id).map_err(|message| message.to_string())?;
    let meta = fs::symlink_metadata(source).map_err(|_| "Choose a file.".to_string())?;
    if !meta.file_type().is_file() {
        return Err("Choose a file.".to_string());
    }
    if let Some(message) = size_limit_message(meta.len()) {
        return Err(message.to_string());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|_| "That file could not be saved.".to_string())?;
    }
    fs::copy(source, &dest).map_err(|_| "That file could not be saved.".to_string())?;
    Ok(meta.len())
}

pub fn remove_attachment_files(root: &Path, ids: &[String]) -> Result<(), String> {
    for id in ids {
        let Ok(path) = attachment_path(root, id) else {
            continue;
        };
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("That file could not be removed.".to_string()),
        }
    }
    Ok(())
}

pub fn present_attachment_ids(root: &Path, ids: &[String]) -> Vec<String> {
    ids.iter()
        .filter(|id| attachment_path(root, id).ok().is_some_and(|path| path.is_file()))
        .cloned()
        .collect()
}

pub fn sweep_attachment_files(root: &Path, live: &HashSet<String>) -> Result<(), String> {
    let folder = root.join("attachments");
    if !folder.is_dir() {
        return Ok(());
    }
    let entries = fs::read_dir(&folder).map_err(|_| "That file could not be removed.".to_string())?;
    for entry in entries {
        let entry = entry.map_err(|_| "That file could not be removed.".to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if live.contains(&name) {
            continue;
        }
        let meta = fs::symlink_metadata(entry.path()).map_err(|_| "That file could not be removed.".to_string())?;
        if meta.file_type().is_file() || meta.file_type().is_symlink() {
            fs::remove_file(entry.path()).map_err(|_| "That file could not be removed.".to_string())?;
        }
    }
    Ok(())
}

pub struct StoredBytes {
    pub name: String,
    pub bytes: Vec<u8>,
}

pub fn read_stored_files(root: &Path, budget: &mut u64) -> Result<Vec<StoredBytes>, &'static str> {
    let folder = root.join("attachments");
    if !folder.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    let entries = fs::read_dir(&folder).map_err(|_| "That backup could not be read.")?;
    for entry in entries {
        let entry = entry.map_err(|_| "That backup could not be read.")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !safe_leaf(&name) {
            continue;
        }
        let meta = fs::symlink_metadata(entry.path()).map_err(|_| "That backup could not be read.")?;
        if !meta.file_type().is_file() {
            continue;
        }
        if meta.len() > *budget {
            return Err("That backup is larger than 512 MB.");
        }
        let mut file = File::open(entry.path()).map_err(|_| "That backup could not be read.")?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|_| "That backup could not be read.")?;
        if bytes.len() as u64 > *budget {
            return Err("That backup is larger than 512 MB.");
        }
        *budget -= bytes.len() as u64;
        files.push(StoredBytes { name, bytes });
    }
    files.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(files)
}

pub fn copy_attachment_dir(from_root: &Path, to_root: &Path) -> Result<(), String> {
    let incoming = from_root.join("attachments");
    if !incoming.is_dir() {
        return Ok(());
    }
    let dest = to_root.join("attachments");
    fs::create_dir_all(&dest).map_err(|_| "The files were not all restored.".to_string())?;
    let entries = fs::read_dir(&incoming).map_err(|_| "The files were not all restored.".to_string())?;
    for entry in entries {
        let entry = entry.map_err(|_| "The files were not all restored.".to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !safe_leaf(&name) {
            continue;
        }
        let meta = fs::symlink_metadata(entry.path()).map_err(|_| "The files were not all restored.".to_string())?;
        if !meta.file_type().is_file() {
            continue;
        }
        fs::copy(entry.path(), dest.join(&name)).map_err(|_| "The files were not all restored.".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_cap_names_the_limit() {
        assert_eq!(size_limit_message(MAX_ATTACHMENT_BYTES), None);
        assert_eq!(
            size_limit_message(MAX_ATTACHMENT_BYTES + 1),
            Some("That file is larger than 25 MB.")
        );
    }

    #[test]
    fn attachment_id_cannot_escape_the_directory() {
        let root = std::env::temp_dir().join(format!("layp-attach-path-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        assert!(attachment_path(&root, "../secret").is_err());
        assert!(attachment_path(&root, "..").is_err());
        assert!(attachment_path(&root, "note.txt").is_err());
        let id = "11111111-1111-4111-8111-111111111111";
        let path = attachment_path(&root, id).unwrap();
        assert_eq!(path, root.join("attachments").join(id));
        assert!(path.starts_with(root.join("attachments")));
        fs::create_dir_all(root.join("attachments")).unwrap();
        fs::write(root.join("inside.txt"), b"ok").unwrap();
        let stored = store_attachment(&root, &root.join("inside.txt"), id).unwrap();
        assert_eq!(stored, 2);
        assert_eq!(fs::read(&path).unwrap(), b"ok");
        let _ = fs::remove_dir_all(&root);
    }
}
