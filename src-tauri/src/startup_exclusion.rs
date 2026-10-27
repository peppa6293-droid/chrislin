//! Process-wide exclusion between ordinary app startup and native Migration 4.
//! The stable lock inode is shared by both roles and is never unlinked.
use std::{
    fs::{self, File, OpenOptions},
    os::unix::{fs::{MetadataExt, OpenOptionsExt}, io::AsRawFd},
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug)]
pub enum LockMode { Shared, Exclusive }

pub fn acquire(authority_dir: &Path, mode: LockMode) -> Result<File, String> {
    let dir_meta = fs::symlink_metadata(authority_dir).map_err(|e| format!("STARTUP_LOCK_DIRECTORY_UNAVAILABLE: {e}"))?;
    // SAFETY: geteuid is a side-effect-free query for the current process owner.
    let effective_uid = unsafe { libc::geteuid() };
    if !dir_meta.is_dir() || dir_meta.file_type().is_symlink() || dir_meta.uid() != effective_uid {
        return Err("STARTUP_LOCK_DIRECTORY_IDENTITY_INVALID".into());
    }
    let canonical_dir = authority_dir.canonicalize().map_err(|e| format!("STARTUP_LOCK_DIRECTORY_UNAVAILABLE: {e}"))?;
    if canonical_dir != authority_dir {
        return Err("STARTUP_LOCK_DIRECTORY_REDIRECTED".into());
    }
    let path = authority_dir.join("maintenance.lock");
    let before = match fs::symlink_metadata(&path) {
        Ok(meta) => Some(meta),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("STARTUP_LOCK_IDENTITY_UNAVAILABLE: {error}")),
    };
    if before.as_ref().is_some_and(|m| !m.is_file() || m.file_type().is_symlink() || m.nlink() != 1 || m.mode() & 0o077 != 0 || m.uid() != effective_uid) {
        return Err("STARTUP_LOCK_IDENTITY_INVALID".into());
    }
    let file = OpenOptions::new().read(true).write(true).create(true)
        .mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(&path)
        .map_err(|e| format!("STARTUP_LOCK_OPEN_FAILED: {e}"))?;
    let opened = file.metadata().map_err(|e| format!("STARTUP_LOCK_IDENTITY_UNAVAILABLE: {e}"))?;
    let named = fs::symlink_metadata(&path).map_err(|e| format!("STARTUP_LOCK_IDENTITY_UNAVAILABLE: {e}"))?;
    if !opened.is_file() || opened.nlink() != 1 || opened.mode() & 0o077 != 0 || opened.uid() != effective_uid
        || opened.dev() != named.dev() || opened.ino() != named.ino()
        || before.as_ref().is_some_and(|m| m.dev() != opened.dev() || m.ino() != opened.ino()) {
        return Err("STARTUP_LOCK_IDENTITY_CHANGED".into());
    }
    let operation = match mode { LockMode::Shared => libc::LOCK_SH, LockMode::Exclusive => libc::LOCK_EX } | libc::LOCK_NB;
    // SAFETY: flock only observes the valid descriptor owned by `file`.
    let result = unsafe { libc::flock(file.as_raw_fd(), operation) };
    if result != 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::WouldBlock {
            return Err("STARTUP_EXCLUSION_BUSY".into());
        }
        return Err(format!("STARTUP_LOCK_ACQUIRE_FAILED: {error}"));
    }
    let after = fs::symlink_metadata(&path).map_err(|e| format!("STARTUP_LOCK_IDENTITY_UNAVAILABLE: {e}"))?;
    if opened.dev() != after.dev() || opened.ino() != after.ino() {
        return Err("STARTUP_LOCK_IDENTITY_CHANGED".into());
    }
    Ok(file)
}

fn ensure_identity_directory(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("{label}_UNAVAILABLE: {e}"))?;
    // SAFETY: geteuid is a side-effect-free query for the current process owner.
    let effective_uid = unsafe { libc::geteuid() };
    if !metadata.is_dir() || metadata.file_type().is_symlink() || metadata.uid() != effective_uid {
        return Err(format!("{label}_IDENTITY_INVALID"));
    }
    let canonical = path.canonicalize().map_err(|e| format!("{label}_UNAVAILABLE: {e}"))?;
    if canonical != path {
        return Err(format!("{label}_REDIRECTED"));
    }
    Ok(())
}

fn directory_is_missing(path: &Path, label: &str) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(format!("{label}_UNAVAILABLE: {error}")),
    }
}

/// Proves the Production data directory without creating anything: the home
/// directory, `Library` and `Application Support` must already exist with a
/// verified identity, and the data directory is either verified as well or
/// proven absent beneath that verified parent chain.
pub fn verify_production_data_dir(home: &Path, identifier: &str) -> Result<PathBuf, String> {
    if identifier != "com.personalfinance.console" {
        return Err("STARTUP_LOCK_PRODUCTION_IDENTITY_REQUIRED".into());
    }
    let canonical_home = home.canonicalize().map_err(|e| format!("STARTUP_LOCK_HOME_UNAVAILABLE: {e}"))?;
    ensure_identity_directory(&canonical_home, "STARTUP_LOCK_HOME")?;
    let library = canonical_home.join("Library");
    ensure_identity_directory(&library, "STARTUP_LOCK_LIBRARY")?;
    let support = library.join("Application Support");
    if !directory_is_missing(&support, "STARTUP_LOCK_DIRECTORY")? {
        ensure_identity_directory(&support, "STARTUP_LOCK_DIRECTORY")?;
    }
    let authority = support.join(identifier);
    if !directory_is_missing(&authority, "STARTUP_LOCK_DIRECTORY")? {
        ensure_identity_directory(&authority, "STARTUP_LOCK_DIRECTORY")?;
    }
    Ok(authority)
}

pub fn production_authority(home: &Path, identifier: &str) -> Result<PathBuf, String> {
    let authority = verify_production_data_dir(home, identifier)?;
    let support = authority.parent().ok_or("STARTUP_LOCK_DIRECTORY_UNAVAILABLE: Production data directory has no parent.")?;
    // Every missing component is created with `mkdir` semantics only after its
    // parent chain is proven, and is re-verified immediately afterwards. A
    // pre-existing symlink at either component makes the create attempt fail.
    if directory_is_missing(support, "STARTUP_LOCK_DIRECTORY")? {
        fs::create_dir(support).map_err(|e| format!("STARTUP_LOCK_DIRECTORY_CREATE_FAILED: {e}"))?;
        ensure_identity_directory(support, "STARTUP_LOCK_DIRECTORY")?;
    }
    if directory_is_missing(&authority, "STARTUP_LOCK_DIRECTORY")? {
        fs::create_dir(&authority).map_err(|e| format!("STARTUP_LOCK_DIRECTORY_CREATE_FAILED: {e}"))?;
        ensure_identity_directory(&authority, "STARTUP_LOCK_DIRECTORY")?;
    }
    Ok(authority)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::atomic::{AtomicU64, Ordering}, time::{SystemTime, UNIX_EPOCH}};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        for _ in 0..100 {
            let path = std::env::temp_dir().join(format!("pfc-startup-exclusion-{}-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(), TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)));
            match fs::create_dir(&path) {
                Ok(()) => return path,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("failed to create synthetic startup lock test directory: {error}"),
            }
        }
        panic!("could not allocate a unique startup lock test directory")
    }

    #[test]
    fn shared_ui_locks_coexist_and_exclude_migration() {
        let root = temp_dir().canonicalize().unwrap();
        let ui_a = acquire(&root, LockMode::Shared).unwrap();
        let ui_b = acquire(&root, LockMode::Shared).unwrap();
        assert_eq!(acquire(&root, LockMode::Exclusive).unwrap_err(), "STARTUP_EXCLUSION_BUSY");
        drop((ui_a, ui_b));
        let migration = acquire(&root, LockMode::Exclusive).unwrap();
        assert_eq!(acquire(&root, LockMode::Shared).unwrap_err(), "STARTUP_EXCLUSION_BUSY");
        drop(migration);
        assert!(acquire(&root, LockMode::Shared).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_symlink_lock_path() {
        let root = temp_dir().canonicalize().unwrap();
        let other = root.join("other");
        fs::write(&other, b"").unwrap();
        std::os::unix::fs::symlink(other, root.join("maintenance.lock")).unwrap();
        assert_eq!(acquire(&root, LockMode::Shared).unwrap_err(), "STARTUP_LOCK_IDENTITY_INVALID");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fifty_ui_migration_acquisition_races_never_double_win() {
        use std::sync::{Arc, Barrier, mpsc};
        let mut rows = Vec::new();
        for iteration in 1..=50 {
            let root = temp_dir().canonicalize().unwrap();
            let start = Arc::new(Barrier::new(3));
            let release = Arc::new(Barrier::new(3));
            let (tx, rx) = mpsc::channel();
            let mut joins = Vec::new();
            for (role, mode) in [("ui", LockMode::Shared), ("migration", LockMode::Exclusive)] {
                let root = root.clone();
                let start = Arc::clone(&start);
                let release = Arc::clone(&release);
                let tx = tx.clone();
                joins.push(std::thread::spawn(move || {
                    start.wait();
                    let acquired = acquire(&root, mode).ok();
                    tx.send((role, acquired.is_some())).unwrap();
                    release.wait();
                    drop(acquired);
                }));
            }
            start.wait();
            let a = rx.recv().unwrap();
            let b = rx.recv().unwrap();
            let double_win = a.1 && b.1;
            rows.push(serde_json::json!({"iteration":iteration,"ui_acquired":if a.0=="ui"{a.1}else{b.1},
                "migration_acquired":if a.0=="migration"{a.1}else{b.1},"double_win":double_win}));
            release.wait();
            for join in joins { join.join().unwrap(); }
            fs::remove_dir_all(root).unwrap();
            assert!(!double_win, "UI and migration both acquired the same authority lock in iteration {iteration}");
        }
        let path = Path::new("../evidence/wp04-release-cutover-readiness/53-r2c3c1-production-durable-terminal/12-regression/STARTUP_EXCLUSION_RACE_MATRIX.json");
        fs::write(path, serde_json::to_vec_pretty(&serde_json::json!({"format_version":1,"authority":"same maintenance.lock inode","iterations":rows,"double_win_count":0})).unwrap()).unwrap();
    }
}
