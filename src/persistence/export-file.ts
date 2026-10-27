import { invoke } from "@tauri-apps/api/core";

/**
 * Persists an export to the user's Downloads folder through the native
 * `save_export_file` command. Nothing leaves the machine and the frontend
 * cannot choose an arbitrary destination path.
 */
export async function saveExportFile(fileName: string, contents: string): Promise<string> {
  return invoke<string>("save_export_file", { fileName, contents });
}
