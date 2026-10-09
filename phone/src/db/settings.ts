import type { ClockPreference } from "@layp/shared";
import { withLock } from "./lock";
import type { Run } from "./sql";

export async function readClock(run: Run): Promise<ClockPreference> {
  const loaded = await run([{ sql: `SELECT value FROM settings WHERE key = 'clock'`, values: [] }]);
  return loaded.batches[0]?.rows[0]?.value === "24" ? "24" : "12";
}

export function loadClock(): Promise<ClockPreference> {
  return withLock(readClock);
}
