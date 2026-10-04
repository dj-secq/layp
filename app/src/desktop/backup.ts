import { invoke } from "@tauri-apps/api/core";

export function exportBackup(folder: string): Promise<void> {
  return invoke("export_backup", { folder });
}

export function exportZip(destination: string): Promise<void> {
  return invoke("export_zip", { destination });
}

export function checkBackup(source: string): Promise<void> {
  return invoke("check_backup", { source });
}

export function importBackup(source: string): Promise<void> {
  return invoke("import_backup", { source });
}

export function showDatabaseFolder(): Promise<void> {
  return invoke("show_database_folder");
}

export function showLogFolder(): Promise<void> {
  return invoke("show_log_folder");
}

export function failureText(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}
