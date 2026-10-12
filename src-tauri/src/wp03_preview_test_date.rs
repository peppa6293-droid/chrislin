use std::sync::Mutex;
use tauri::{AppHandle, State};

use crate::wp03_preview_isolation::IDENTIFIER;

#[derive(Default)]
pub struct SessionDate(Mutex<Option<String>>);

impl SessionDate {
    fn read(&self) -> Result<Option<String>, String> {
        self.0
            .lock()
            .map(|date| date.clone())
            .map_err(|_| "WP-03 验收日期状态不可用。".to_string())
    }

    fn write(&self, date: Option<String>) -> Result<(), String> {
        if let Some(value) = date.as_deref() {
            validate_date(value)?;
        }
        *self
            .0
            .lock()
            .map_err(|_| "WP-03 验收日期状态不可用。".to_string())? = date;
        Ok(())
    }
}

fn require_preview_identity(identifier: &str) -> Result<(), String> {
    if identifier == IDENTIFIER {
        Ok(())
    } else {
        Err("WP-03 验收日期拒绝非 WP-03 preview Bundle ID。".into())
    }
}

fn validate_date(value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
    {
        return Err("验收日期必须是有效的 YYYY-MM-DD 日期。".into());
    }
    let year = value[0..4].parse::<u32>().map_err(|_| "验收日期无效。")?;
    let month = value[5..7].parse::<u32>().map_err(|_| "验收日期无效。")?;
    let day = value[8..10].parse::<u32>().map_err(|_| "验收日期无效。")?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return Err("验收日期必须是有效的 YYYY-MM-DD 日期。".into()),
    };
    if year == 0 || day == 0 || day > days {
        return Err("验收日期必须是有效的 YYYY-MM-DD 日期。".into());
    }
    Ok(())
}

#[tauri::command]
pub fn wp03_preview_get_test_date(
    app: AppHandle,
    date: State<'_, SessionDate>,
) -> Result<Option<String>, String> {
    require_preview_identity(&app.config().identifier)?;
    date.read()
}

#[tauri::command]
pub fn wp03_preview_set_test_date(
    app: AppHandle,
    date: State<'_, SessionDate>,
    test_date: Option<String>,
) -> Result<(), String> {
    require_preview_identity(&app.config().identifier)?;
    date.write(test_date)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_identity_is_required_for_test_date_control() {
        assert!(require_preview_identity(IDENTIFIER).is_ok());
        for identifier in [
            "com.personalfinance.console",
            "com.personalfinance.console.wp02preview",
            "com.personalfinance.console.v4acceptance",
            "com.personalfinance.console.smoke",
        ] {
            assert!(require_preview_identity(identifier).is_err(), "{identifier}");
        }
    }

    #[test]
    fn date_control_is_session_only_and_starts_unset_after_restart() {
        let first_session = SessionDate::default();
        assert_eq!(first_session.read().unwrap(), None);
        first_session.write(Some("2026-11-01".into())).unwrap();
        assert_eq!(first_session.read().unwrap().as_deref(), Some("2026-11-01"));

        let restarted_session = SessionDate::default();
        assert_eq!(restarted_session.read().unwrap(), None);
    }

    #[test]
    fn rejects_invalid_calendar_dates() {
        assert!(validate_date("2026-11-01").is_ok());
        assert!(validate_date("2024-02-29").is_ok());
        for invalid in ["2026-02-29", "2026-13-01", "2026-04-31", "2026-2-01"] {
            assert!(validate_date(invalid).is_err(), "{invalid}");
        }
    }
}
