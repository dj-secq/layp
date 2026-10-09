import {
  applyStatements,
  changesSinceStatements,
  cursorPoints,
  decodeChangesSince,
  nextCursor,
  syncPayloadWithinLimit,
  type Cursor,
} from "@layp/shared";
import type { SyncRequest, SyncResponse } from "../link/protocol";
import type { Run } from "./sql";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Reads the phone cursors and the rows above `ack`. The caller posts this outside the lock. */
export async function pushRequest(run: Run, wait: boolean): Promise<SyncRequest> {
  const state = await run([
    { sql: `SELECT have_at, have_id, ack_at, ack_id FROM link_state WHERE id = 'desktop'`, values: [] },
  ]);
  const row = state.batches[0]?.rows[0] ?? {};
  const have: Cursor = { at: text(row.have_at), id: text(row.have_id) };
  const ack: Cursor = { at: text(row.ack_at), id: text(row.ack_id) };
  const since = await run(changesSinceStatements(ack));
  const batch = decodeChangesSince(since.batches);
  const wantAck = nextCursor(ack, cursorPoints(batch), since.now);
  return { phoneId: "phone", have, wantAck, wait, rows: batch.rows, deletions: batch.deletions };
}

/**
 * Apply, then sample the clock inside `changesSince`, then store the desktop echo.
 * The stored ack is the response, not a cursor recomputed from the local read.
 */
export async function applyRemoteWith(run: Run, response: SyncResponse): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ rows: response.rows, deletions: response.deletions })).byteLength;
  if (!syncPayloadWithinLimit(bytes)) throw new Error("sync payload is over the limit");
  const state = await run([
    { sql: `SELECT ack_at, ack_id FROM link_state WHERE id = 'desktop'`, values: [] },
  ]);
  const previous: Cursor = {
    at: text(state.batches[0]?.rows[0]?.ack_at),
    id: text(state.batches[0]?.rows[0]?.ack_id),
  };
  await run(applyStatements({ rows: response.rows, deletions: response.deletions }, "phone"));
  const since = await run(changesSinceStatements(previous));
  await run([
    {
      sql: `UPDATE link_state SET have_at = $1, have_id = $2, ack_at = $3, ack_id = $4 WHERE id = 'desktop'`,
      values: [response.have.at, response.have.id, response.ack.at, response.ack.id],
    },
  ]);
  return since.now;
}
