# Gate Exclusion Readback

The existing synthetic Gate `MaintenanceLease` holds exclusive `maintenance.lock`. The signed test UI app attempts the same canonical synthetic root at S5 and after COMMIT. Each attempt logs `STARTUP_EXCLUSION_BUSY` and exits before the Tauri Builder/WebView; the migration process remains active.
