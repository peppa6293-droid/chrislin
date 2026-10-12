use std::fs;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

pub const IDENTIFIER: &str = "com.personalfinance.console.wp03preview";
pub const DATABASE: &str = "personal-finance-console.sqlite3";
const FORBIDDEN: [&str; 4] = [
    "com.personalfinance.console",
    "com.personalfinance.console.smoke",
    "com.personalfinance.console.v4acceptance",
    "com.personalfinance.console.wp02preview",
];

fn metadata(path: &Path, label: &str) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("WP-03 {label} cannot be inspected: {error}")),
    }
}

fn require_directory(path: &Path, label: &str) -> Result<(), String> {
    if let Some(value) = metadata(path, label)? {
        if value.file_type().is_symlink() || !value.is_dir() {
            return Err(format!("WP-03 {label} must be a real directory."));
        }
    }
    Ok(())
}

fn verify_ancestors(path: &Path) -> Result<(), String> {
    let mut current = path.to_path_buf();
    let mut missing = Vec::new();
    loop {
        match metadata(&current, "path component")? {
            Some(value) => {
                if value.file_type().is_symlink() || !value.is_dir() {
                    return Err("WP-03 data path contains a symlink or non-directory component.".into());
                }
                break;
            }
            None => {
                missing.push(current.clone());
                let Some(parent) = current.parent() else { break };
                if parent == current { break }
                current = parent.to_path_buf();
            }
        }
    }
    for path in missing.iter().rev() {
        if let Some(parent) = path.parent() {
            require_directory(parent, "parent directory")?;
        }
    }
    Ok(())
}

pub fn ensure_isolated(identifier: &str, data_dir: &Path, home_dir: &Path) -> Result<(), String> {
    if identifier != IDENTIFIER {
        return Err("WP-03 preview refused an unexpected Bundle ID.".into());
    }
    let support = home_dir.join("Library/Application Support");
    let expected = support.join(IDENTIFIER);
    if data_dir != expected || FORBIDDEN.iter().any(|id| data_dir == support.join(id)) {
        return Err("WP-03 preview refused an unexpected or protected app-data path.".into());
    }
    verify_ancestors(&support)?;
    require_directory(&expected, "app-data directory")?;
    if let Some(parent) = expected.parent() {
        require_directory(parent, "app-data parent")?;
    }
    let database = expected.join(DATABASE);
    if let Some(value) = metadata(&database, "database file")? {
        #[cfg(unix)]
        let single_link = value.nlink() == 1;
        #[cfg(not(unix))]
        let single_link = true;
        if value.file_type().is_symlink() || !value.is_file() || !single_link {
            return Err("WP-03 database must be an in-place single-link regular file.".into());
        }
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = PathBuf::from(format!("{}{}", database.display(), suffix));
        if metadata(&sidecar, "SQLite sidecar")?.is_some() {
            return Err("WP-03 refuses startup while a SQLite sidecar already exists.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn home() -> PathBuf {
        std::env::temp_dir().join(format!("wp03-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()))
    }

    #[test]
    fn exact_absent_domain_is_accepted_without_creation() {
        let home = home();
        let data = home.join("Library/Application Support").join(IDENTIFIER);
        assert!(ensure_isolated(IDENTIFIER, &data, &home).is_ok());
        assert!(!data.exists());
    }

    #[test]
    fn rejects_wrong_and_protected_identities() {
        let home = home();
        let data = home.join("Library/Application Support").join(IDENTIFIER);
        assert!(ensure_isolated("com.personalfinance.console", &data, &home).is_err());
        for id in FORBIDDEN { assert!(ensure_isolated(IDENTIFIER, &home.join("Library/Application Support").join(id), &home).is_err()); }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_directories_database_and_sidecars() {
        use std::os::unix::fs::symlink;
        let home = home();
        let support = home.join("Library/Application Support");
        fs::create_dir_all(&support).unwrap();
        let data = support.join(IDENTIFIER);
        let redirect = home.join("redirect");
        fs::create_dir(&redirect).unwrap();
        symlink(&redirect, &data).unwrap();
        assert!(ensure_isolated(IDENTIFIER, &data, &home).is_err());
        fs::remove_file(&data).unwrap();
        fs::create_dir(&data).unwrap();
        symlink(redirect.join(DATABASE), data.join(DATABASE)).unwrap();
        assert!(ensure_isolated(IDENTIFIER, &data, &home).is_err());
        fs::remove_file(data.join(DATABASE)).unwrap();
        fs::write(data.join(DATABASE), b"synthetic").unwrap();
        fs::write(data.join(format!("{}-wal", DATABASE)), b"sidecar").unwrap();
        assert!(ensure_isolated(IDENTIFIER, &data, &home).is_err());
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_database_with_multiple_hard_links() {
        let home = home();
        let data = home.join("Library/Application Support").join(IDENTIFIER);
        fs::create_dir_all(&data).unwrap();
        let database = data.join(DATABASE);
        let second_link = home.join("second-link.sqlite3");
        fs::write(&database, b"synthetic").unwrap();
        fs::hard_link(&database, &second_link).unwrap();
        assert!(ensure_isolated(IDENTIFIER, &data, &home).is_err());
        fs::remove_dir_all(home).unwrap();
    }
}
