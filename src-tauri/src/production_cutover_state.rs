//! Fixed-name, Production-only durable terminal and claimed-authorization discovery.
//! This module never grants authority; callers must validate the terminal's bindings.
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub const TERMINAL_NAME: &str = "production-v4-cutover-terminal.json";
pub const CLAIMED_AUTHORIZATION_PREFIX: &str = ".production-v4-migration-authorization.json.claimed-";
const TEMP_PREFIX: &str = ".production-v4-cutover-terminal.json.tmp-";
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteCheckpoint { BeforeWrite, BeforeFileSync, BeforeDirectorySync, AfterDurableReadback }

fn canonical_owner_directory(directory: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(directory).map_err(|error| format!("PRODUCTION_STATE_DIRECTORY_UNAVAILABLE: {error}"))?;
    // SAFETY: geteuid only reads the current process user id.
    let uid = unsafe { libc::geteuid() };
    if !metadata.is_dir() || metadata.file_type().is_symlink() || metadata.uid() != uid || directory.canonicalize().ok().as_deref() != Some(directory) {
        return Err("PRODUCTION_STATE_DIRECTORY_IDENTITY_INVALID".into());
    }
    Ok(())
}

fn safe_metadata(path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    // SAFETY: geteuid only reads the current process user id.
    let uid = unsafe { libc::geteuid() };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.nlink() != 1 || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return Err("PRODUCTION_STATE_FILE_IDENTITY_INVALID".into());
    }
    Ok(metadata)
}

pub fn claimed_authorization_present(directory: &Path) -> Result<bool, String> {
    canonical_owner_directory(directory)?;
    let entries = fs::read_dir(directory).map_err(|error| format!("PRODUCTION_STATE_DIRECTORY_UNREADABLE: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("PRODUCTION_STATE_DIRECTORY_UNREADABLE: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(CLAIMED_AUTHORIZATION_PREFIX) {
            safe_metadata(&entry.path()).map_err(|_| "PRODUCTION_AUTHORIZATION_CLAIM_UNSAFE".to_string())?;
            return Ok(true);
        }
        if name.starts_with(TEMP_PREFIX) {
            safe_metadata(&entry.path()).map_err(|_| "PRODUCTION_TERMINAL_TEMP_UNSAFE".to_string())?;
            return Err("PRODUCTION_TERMINAL_WRITE_UNRESOLVED".into());
        }
    }
    Ok(false)
}

pub fn read_terminal(directory: &Path) -> Result<Option<Vec<u8>>, String> {
    canonical_owner_directory(directory)?;
    let path = directory.join(TERMINAL_NAME);
    let before = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("PRODUCTION_TERMINAL_UNREADABLE: {error}")),
    };
    safe_metadata(&path).map_err(|error| format!("PRODUCTION_TERMINAL_UNSAFE: {error}"))?;
    let mut file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&path).map_err(|error| format!("PRODUCTION_TERMINAL_UNREADABLE: {error}"))?;
    let key = |metadata: &fs::Metadata| (metadata.dev(), metadata.ino(), metadata.len(), metadata.nlink(), metadata.mtime(), metadata.mtime_nsec());
    if key(&file.metadata().map_err(|error| error.to_string())?) != key(&before) { return Err("PRODUCTION_TERMINAL_IDENTITY_CHANGED".into()); }
    let mut bytes = Vec::new();
    (&mut file).take(1_048_577).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() > 1_048_576 || key(&file.metadata().map_err(|error| error.to_string())?) != key(&before)
        || key(&fs::symlink_metadata(&path).map_err(|error| error.to_string())?) != key(&before) {
        return Err("PRODUCTION_TERMINAL_IDENTITY_CHANGED".into());
    }
    Ok(Some(bytes))
}

pub fn read_authority_file(directory: &Path, name: &str) -> Result<Option<Vec<u8>>, String> {
    canonical_owner_directory(directory)?;
    if name.is_empty() || name.contains('/') || name == "." || name == ".." {
        return Err("PRODUCTION_AUTHORITY_FILENAME_INVALID".into());
    }
    let path = directory.join(name);
    let before = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("PRODUCTION_AUTHORITY_FILE_UNREADABLE: {error}")),
    };
    safe_metadata(&path).map_err(|error| format!("PRODUCTION_AUTHORITY_FILE_UNSAFE: {error}"))?;
    let mut file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&path).map_err(|error| format!("PRODUCTION_AUTHORITY_FILE_UNREADABLE: {error}"))?;
    let key = |metadata: &fs::Metadata| (metadata.dev(), metadata.ino(), metadata.len(), metadata.nlink(), metadata.mtime(), metadata.mtime_nsec());
    if key(&file.metadata().map_err(|error| error.to_string())?) != key(&before) { return Err("PRODUCTION_AUTHORITY_FILE_IDENTITY_CHANGED".into()); }
    let mut bytes = Vec::new();
    (&mut file).take(1_048_577).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() > 1_048_576 || key(&file.metadata().map_err(|error| error.to_string())?) != key(&before)
        || key(&fs::symlink_metadata(&path).map_err(|error| error.to_string())?) != key(&before) {
        return Err("PRODUCTION_AUTHORITY_FILE_IDENTITY_CHANGED".into());
    }
    Ok(Some(bytes))
}

pub fn write_terminal<F>(directory: &Path, bytes: &[u8], mut checkpoint: F) -> Result<Vec<u8>, String>
where F: FnMut(WriteCheckpoint) -> Result<(), String> {
    canonical_owner_directory(directory)?;
    if bytes.is_empty() || bytes.len() > 1_048_576 { return Err("PRODUCTION_TERMINAL_SIZE_INVALID".into()); }
    let terminal = directory.join(TERMINAL_NAME);
    if fs::symlink_metadata(&terminal).is_ok() { return Err("PRODUCTION_TERMINAL_ALREADY_EXISTS".into()); }
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
    let temp = directory.join(format!("{TEMP_PREFIX}{}-{nonce}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true).mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let mut file = options.open(&temp).map_err(|error| format!("PRODUCTION_TERMINAL_TEMP_CREATE_FAILED: {error}"))?;
    let result = (|| {
        let created = file.metadata().map_err(|error| error.to_string())?;
        let named = fs::symlink_metadata(&temp).map_err(|error| error.to_string())?;
        // SAFETY: geteuid only reads the current process user id.
        let uid = unsafe { libc::geteuid() };
        if !created.is_file() || created.file_type().is_symlink() || created.nlink() != 1 || created.uid() != uid
            || created.mode() & 0o077 != 0 || created.dev() != named.dev() || created.ino() != named.ino() {
            return Err("PRODUCTION_TERMINAL_TEMP_IDENTITY_INVALID".into());
        }
        checkpoint(WriteCheckpoint::BeforeWrite)?;
        file.write_all(bytes).map_err(|error| format!("PRODUCTION_TERMINAL_WRITE_FAILED: {error}"))?;
        checkpoint(WriteCheckpoint::BeforeFileSync)?;
        file.sync_all().map_err(|error| format!("PRODUCTION_TERMINAL_FILE_FSYNC_FAILED: {error}"))?;
        let after_write = safe_metadata(&temp).map_err(|error| format!("PRODUCTION_TERMINAL_TEMP_IDENTITY_INVALID: {error}"))?;
        if after_write.dev() != created.dev() || after_write.ino() != created.ino() { return Err("PRODUCTION_TERMINAL_TEMP_IDENTITY_CHANGED".into()); }
        if fs::symlink_metadata(&terminal).is_ok() { return Err("PRODUCTION_TERMINAL_ALREADY_EXISTS".into()); }
        fs::hard_link(&temp, &terminal).map_err(|error| format!("PRODUCTION_TERMINAL_PUBLISH_FAILED: {error}"))?;
        fs::remove_file(&temp).map_err(|error| format!("PRODUCTION_TERMINAL_TEMP_REMOVE_FAILED: {error}"))?;
        if let Err(error) = checkpoint(WriteCheckpoint::BeforeDirectorySync) {
            let _ = fs::remove_file(&terminal);
            let _ = File::open(directory).and_then(|directory_file| directory_file.sync_all());
            return Err(error);
        }
        if let Err(error) = File::open(directory).and_then(|directory_file| directory_file.sync_all()) {
            let _ = fs::remove_file(&terminal);
            let _ = File::open(directory).and_then(|directory_file| directory_file.sync_all());
            return Err(format!("PRODUCTION_TERMINAL_DIRECTORY_FSYNC_FAILED: {error}"));
        }
        let readback = read_terminal(directory)?.ok_or("PRODUCTION_TERMINAL_READBACK_MISSING")?;
        if readback != bytes { return Err("PRODUCTION_TERMINAL_EXACT_READBACK_MISMATCH".into()); }
        checkpoint(WriteCheckpoint::AfterDurableReadback)?;
        Ok(readback)
    })();
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("pfc-production-state-{}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&path).unwrap();
        path.canonicalize().unwrap()
    }

    #[test]
    fn terminal_is_create_only_durable_exact_and_rejects_symlinks() {
        let root = temp_dir();
        let bytes = br#"{"domain":"PRODUCTION","state":"V4_VERIFIED"}"#;
        assert_eq!(write_terminal(&root, bytes, |_| Ok(())).unwrap(), bytes);
        assert_eq!(read_terminal(&root).unwrap().unwrap(), bytes);
        assert!(write_terminal(&root, bytes, |_| Ok(())).is_err());
        let other = root.join("other"); fs::write(&other, bytes).unwrap();
        fs::remove_file(root.join(TERMINAL_NAME)).unwrap();
        symlink(other, root.join(TERMINAL_NAME)).unwrap();
        assert!(read_terminal(&root).unwrap_err().contains("UNSAFE"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prepublication_file_sync_failure_leaves_no_terminal() {
        let root = temp_dir();
        let result = write_terminal(&root, br#"{"state":"V4_VERIFIED"}"#, |stage| {
            if stage == WriteCheckpoint::BeforeFileSync { Err("injected file fsync failure".into()) } else { Ok(()) }
        });
        assert!(result.is_err());
        assert!(read_terminal(&root).unwrap().is_none());
        assert!(fs::read_dir(&root).unwrap().next().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unresolved_claim_name_is_discovered() {
        let root = temp_dir();
        assert!(!claimed_authorization_present(&root).unwrap());
        let claim = root.join(format!("{CLAIMED_AUTHORIZATION_PREFIX}1-2"));
        fs::write(&claim, b"{}").unwrap();
        fs::set_permissions(&claim, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(claimed_authorization_present(&root).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
