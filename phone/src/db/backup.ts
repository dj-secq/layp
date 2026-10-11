import { File, Paths } from "expo-file-system";
import { getDocumentAsync } from "expo-document-picker";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { checkpointPhoneDatabase, closePhoneDatabase, openPhoneDatabase } from "./open";

function phoneDatabaseFile(): File {
  return new File(Paths.document, "layp.db");
}

function sideFile(name: string): File {
  return new File(Paths.document, name);
}

function sqliteHeader(file: File): boolean {
  const handle = file.open();
  try {
    const bytes = handle.readBytesSync(16);
    return new TextDecoder().decode(bytes).startsWith("SQLite format 3");
  } finally {
    handle.close();
  }
}

function dropSidecars(): void {
  for (const name of ["layp.db-wal", "layp.db-shm"]) {
    const file = sideFile(name);
    if (file.exists) file.delete();
  }
}

/** Share this phone's layp.db. Returns an error sentence, or null when the sheet opened. */
export async function exportPhoneDatabase(): Promise<string | null> {
  try {
    if (!(await isAvailableAsync())) return "Sharing is not available on this phone.";
    await checkpointPhoneDatabase();
    const file = phoneDatabaseFile();
    if (!file.exists) return "The database file is not here yet.";
    await shareAsync(file.uri, { mimeType: "application/x-sqlite3", dialogTitle: "Export Layp" });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/cancel/i.test(message)) return null;
    return "Export failed.";
  }
}

export async function pickDatabaseFile(): Promise<string | null> {
  const picked = await getDocumentAsync({ copyToCacheDirectory: true, type: "*/*", multiple: false });
  if (picked.canceled) return null;
  return picked.assets[0]?.uri ?? null;
}

/**
 * Replace this phone's layp.db. A file that is not SQLite is refused.
 * If the new file cannot be opened, the previous file is put back.
 */
export async function importPhoneDatabase(uri: string): Promise<string | null> {
  const source = new File(uri);
  if (!source.exists) return "That file is not here.";
  if (!sqliteHeader(source)) return "That file is not a Layp database.";
  const current = phoneDatabaseFile();
  const previous = sideFile("layp.db.previous");
  try {
    await checkpointPhoneDatabase();
    await closePhoneDatabase();
  } catch {
    return "Import failed. The current database was left in place.";
  }
  try {
    if (current.exists) await current.copy(previous, { overwrite: true });
    await source.copy(current, { overwrite: true });
    dropSidecars();
    await openPhoneDatabase();
    if (previous.exists) previous.delete();
    return null;
  } catch {
    try {
      if (previous.exists) await previous.copy(current, { overwrite: true });
      dropSidecars();
      await openPhoneDatabase();
      if (previous.exists) previous.delete();
    } catch {
      return "Import failed. Reopen Layp.";
    }
    return "That file could not be opened. The previous database is back.";
  }
}
