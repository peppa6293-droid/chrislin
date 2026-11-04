import { invoke } from "@tauri-apps/api/core";

/**
 * Persists an export to the user's Downloads folder through the native
 * `save_export_file` command. Nothing leaves the machine and the frontend
 * cannot choose an arbitrary destination path.
 */
export async function saveExportFile(fileName: string, contents: string): Promise<string> {
  return invoke<string>("save_export_file", { fileName, contents });
}

export interface DatabaseBackupReceipt {
  path: string;
  sha256: string;
}

/** Saves a complete single-file SQLite backup to the app's fixed export directory. */
export async function saveDatabaseBackup(): Promise<DatabaseBackupReceipt> {
  return invoke<DatabaseBackupReceipt>("save_database_backup");
}
