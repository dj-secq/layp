import { parsePairingCode, ZERO_CURSOR, type Cursor, type SyncDeletion, type SyncRow } from "@layp/shared";

export type SyncRequest = {
  phoneId: "phone";
  have: Cursor;
  wantAck: Cursor;
  wait: boolean;
  rows: SyncRow[];
  deletions: SyncDeletion[];
};

export type SyncResponse = {
  ack: Cursor;
  have: Cursor;
  rows: SyncRow[];
  deletions: SyncDeletion[];
};

export const UNPAIRED = "This phone is not paired.";
export const UNREACHABLE = "Computer not reachable";
export const PAIR_GRAMMAR = "Enter the full layp:1 code from the computer.";
export const PAIR_REJECTED = "That code was not accepted.";
export const PAIR_USED = "That code has already been used.";

export const IDLE_BACKOFF_MS = 15_000;
export const SYNC_TIMEOUT_MS = 22_000;
export const PAIR_TIMEOUT_MS = 10_000;

export function nextIdleDelay(ok: boolean): number {
  return ok ? 0 : IDLE_BACKOFF_MS;
}

export function successLabel(at: string): string {
  return at;
}

/** Trimmed, 1–40 characters, otherwise the desktop default. */
export function pairName(raw: string): string {
  const trimmed = raw.trim();
  const count = [...trimmed].length;
  if (count >= 1 && count <= 40) return trimmed;
  return "Phone";
}

/** Dotted IPv4 and an integer port. The same checks as `parsePairingCode`. */
export function parseHostPort(host: string, port: string): { host: string; port: number } | null {
  const trimmedHost = host.trim();
  const trimmedPort = port.trim();
  const parsed = parsePairingCode(`layp:1:${trimmedHost}:${trimmedPort}:22222222`);
  if (!parsed || parsed.host !== trimmedHost) return null;
  return { host: parsed.host, port: parsed.port };
}

/** The first POST after pairing. Not `changesSince("")`, which would upload the seeded inbox. */
export function initialSyncRequest(): SyncRequest {
  return {
    phoneId: "phone",
    have: ZERO_CURSOR,
    wantAck: ZERO_CURSOR,
    wait: false,
    rows: [],
    deletions: [],
  };
}

export function pairFailure(status: number): string {
  if (status === 401) return PAIR_REJECTED;
  if (status === 410) return PAIR_USED;
  return UNREACHABLE;
}

export function syncFailure(status: number): string {
  if (status === 401) return UNPAIRED;
  return UNREACHABLE;
}

export function parsePairResponse(value: unknown): { phoneId: "phone"; key: string } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { phoneId?: unknown; key?: unknown };
  if (raw.phoneId !== "phone" || typeof raw.key !== "string") return null;
  return { phoneId: "phone", key: raw.key };
}

export function parseSyncResponse(value: unknown): SyncResponse | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { ack?: unknown; have?: unknown; rows?: unknown; deletions?: unknown };
  const ack = asCursor(raw.ack);
  const have = asCursor(raw.have);
  if (!ack || !have || !Array.isArray(raw.rows) || !Array.isArray(raw.deletions)) return null;
  return {
    ack,
    have,
    rows: raw.rows as SyncRow[],
    deletions: raw.deletions as SyncDeletion[],
  };
}

function asCursor(value: unknown): Cursor | null {
  if (!value || typeof value !== "object") return null;
  const cursor = value as { at?: unknown; id?: unknown };
  if (typeof cursor.at !== "string" || typeof cursor.id !== "string") return null;
  return { at: cursor.at, id: cursor.id };
}
