import {
  applyStatements,
  changesSinceStatements,
  cursorPoints,
  decodeChangesSince,
  nextCursor,
  pairedPhoneStatements,
  syncPayloadWithinLimit,
  ZERO_CURSOR,
  type Cursor,
  type SyncDeletion,
  type SyncRow,
} from "@layp/shared";
import { logFailure, withLock, writeStamped, type SqlTxResult } from "./client";
import { invoke } from "@tauri-apps/api/core";

export type PhonePush = {
  phase: "apply" | "poll";
  id: string;
  have: Cursor;
  wantAck: Cursor;
  rows: SyncRow[];
  deletions: SyncDeletion[];
};

function asCursor(value: unknown): Cursor {
  if (!value || typeof value !== "object") return ZERO_CURSOR;
  const cursor = value as { at?: unknown; id?: unknown };
  if (typeof cursor.at === "string" && typeof cursor.id === "string") return { at: cursor.at, id: cursor.id };
  return ZERO_CURSOR;
}

export function readPush(payload: unknown): PhonePush | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as { phase?: unknown; id?: unknown; have?: unknown; wantAck?: unknown; rows?: unknown; deletions?: unknown };
  if ((value.phase !== "apply" && value.phase !== "poll") || typeof value.id !== "string") return null;
  return {
    phase: value.phase,
    id: value.id,
    have: asCursor(value.have),
    wantAck: asCursor(value.wantAck),
    rows: Array.isArray(value.rows) ? (value.rows as SyncRow[]) : [],
    deletions: Array.isArray(value.deletions) ? (value.deletions as SyncDeletion[]) : [],
  };
}

async function reply(id: string, body: string | null): Promise<void> {
  await invoke("phone_reply", { id, body });
}

export function acceptPush(payload: unknown): void {
  const push = readPush(payload);
  if (!push) {
    const id = payload && typeof payload === "object" ? (payload as { id?: unknown }).id : null;
    if (typeof id === "string") void reply(id, null).catch(() => undefined);
    void logFailure("sync failed");
    return;
  }
  void replyToPush(push);
}

/** One lock, then the webview answers. Rust waits for `phone_reply` before it holds the poll. */
export async function replyToPush(push: PhonePush): Promise<void> {
  try {
    const body = await buildSyncResponse(push);
    await reply(push.id, body);
  } catch {
    await logFailure("sync failed");
    try {
      await reply(push.id, null);
    } catch {
      // The reply window may already be closed.
    }
  }
}

async function buildSyncResponse(push: PhonePush): Promise<string> {
  if (push.phase === "poll") {
    return withLock(async (run) => {
      const since: SqlTxResult = await run(changesSinceStatements(push.have));
      const batch = decodeChangesSince(since.batches);
      const have = nextCursor(push.have, cursorPoints(batch), since.now);
      return JSON.stringify({ ack: push.wantAck, have, rows: batch.rows, deletions: batch.deletions });
    });
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ rows: push.rows, deletions: push.deletions })).byteLength;
  if (!syncPayloadWithinLimit(bytes)) throw new Error("sync payload is over the limit");
  return withLock(async (run) => {
    const apply = applyStatements({ rows: push.rows, deletions: push.deletions }, "desktop");
    const first: SqlTxResult = await run([...apply, ...changesSinceStatements(push.have)]);
    const batch = decodeChangesSince(first.batches.slice(apply.length));
    const have = nextCursor(push.have, cursorPoints(batch), first.now);
    await run(pairedPhoneStatements(push.have, push.wantAck, first.now));
    return JSON.stringify({ ack: push.wantAck, have, rows: batch.rows, deletions: batch.deletions });
  });
}

export async function storePairedPhone(input: { name: string; keyHash: string; pairedAt: string }): Promise<void> {
  await writeStamped(() => [
    { sql: "DELETE FROM paired_phone", values: [] },
    {
      sql: `INSERT INTO paired_phone (id, name, key_hash, paired_at, last_sync_at, have_at, have_id, ack_at, ack_id)
            VALUES ('phone', $1, $2, $3, NULL, '', '', '', '')`,
      values: [input.name, input.keyHash, input.pairedAt],
    },
  ]);
}

export async function clearPairedPhone(): Promise<void> {
  await writeStamped(() => [{ sql: "DELETE FROM paired_phone WHERE id = 'phone'", values: [] }]);
}
