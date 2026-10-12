use std::fs;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

pub const IDENTIFIER: &str = "com.personalfinance.console.wp02preview";
pub const DATABASE: &str = "personal-finance-console.sqlite3";

fn reject_untrusted_component(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("WP-02 {label} cannot be inspected: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("WP-02 {label} must not be a symlink."));
    }
    if !metadata.is_dir() {
        return Err(format!("WP-02 {label} must be a directory."));
    }
    Ok(())
}

fn verify_existing_ancestor_chain(path: &Path) -> Result<(), String> {
    let mut current = path.to_path_buf();
    let mut missing = Vec::new();
    while !current.exists() {
        missing.push(current.clone());
        let Some(parent) = current.parent() else { break };
        if parent == current { break }
        current = parent.to_path_buf();
    }
    if current.exists() {
        reject_untrusted_component(&current, "existing ancestor")?;
    }
    for component in missing.iter().rev() {
        if let Some(parent) = component.parent() {
            if parent.exists() {
                reject_untrusted_component(parent, "parent")?;
            }
        }
    }
    Ok(())
}

pub fn ensure_isolated(identifier: &str, data_dir: &Path, home_dir: &Path) -> Result<(), String> {
    if identifier != IDENTIFIER {
        return Err("WP-02 preview runtime refused an unexpected application identity.".into());
    }
    let expected = home_dir.join("Library/Application Support").join(IDENTIFIER);
    if data_dir != expected {
        return Err("WP-02 preview runtime refused an unexpected application-data directory.".into());
    }
    let production = home_dir.join("Library/Application Support").join("com.personalfinance.console");
    let smoke = home_dir.join("Library/Application Support").join("com.personalfinance.console.smoke");
    let acceptance = home_dir.join("Library/Application Support").join("com.personalfinance.console.v4acceptance");
    if data_dir == production || data_dir == smoke || data_dir == acceptance {
        return Err("WP-02 preview runtime refused a protected application-data directory.".into());
    }
    verify_existing_ancestor_chain(&expected)?;
    if expected.exists() {
        reject_untrusted_component(&expected, "data directory")?;
        let database = expected.join(DATABASE);
        if let Ok(metadata) = fs::symlink_metadata(&database) {
            #[cfg(unix)]
            let single_link = metadata.nlink() == 1;
            #[cfg(not(unix))]
            let single_link = true;
            if metadata.file_type().is_symlink() || !metadata.is_file() || !single_link {
                return Err("WP-02 preview database must be an in-place single-link regular file.".into());
            }
        } else if database.exists() {
            return Err("WP-02 database cannot be inspected.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home() -> PathBuf {
        std::env::temp_dir().join(format!("wp02-isolation-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()))
    }

    #[test]
    fn accepts_exact_absent_domain_without_touching_it() {
        let home = temp_home();
        let expected = home.join("Library/Application Support").join(IDENTIFIER);
        assert!(ensure_isolated(IDENTIFIER, &expected, &home).is_ok());
        assert!(!expected.exists());
    }

    #[test]
    fn rejects_wrong_identity_and_protected_paths() {
        let home = temp_home();
        let expected = home.join("Library/Application Support").join(IDENTIFIER);
        let production = home.join("Library/Application Support/com.personalfinance.console");
        assert!(ensure_isolated("com.personalfinance.console.smoke", &expected, &home).is_err());
        assert!(ensure_isolated(IDENTIFIER, &production, &home).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_domain_or_database() {
        use std::os::unix::fs::symlink;
        let home = temp_home();
        let parent = home.join("Library/Application Support");
        fs::create_dir_all(&parent).unwrap();
        let target = home.join("redirected");
        fs::create_dir_all(&target).unwrap();
        let expected = parent.join(IDENTIFIER);
        symlink(&target, &expected).unwrap();
        assert!(ensure_isolated(IDENTIFIER, &expected, &home).is_err());
        fs::remove_file(&expected).unwrap();
        fs::create_dir_all(&expected).unwrap();
        symlink(target.join(DATABASE), expected.join(DATABASE)).unwrap();
        assert!(ensure_isolated(IDENTIFIER, &expected, &home).is_err());
    }
}
