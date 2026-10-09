import { applyRemoteWith, pushRequest } from "../db/apply";
import { withLock } from "../db/lock";
import { openJson, sealJson, decodeKey } from "./crypto";
import { postText } from "./http";
import {
  PAIR_TIMEOUT_MS,
  SYNC_TIMEOUT_MS,
  UNPAIRED,
  UNREACHABLE,
  initialSyncRequest,
  pairFailure,
  parsePairResponse,
  parseSyncResponse,
  syncFailure,
  type SyncRequest,
  type SyncResponse,
} from "./protocol";
import { loadSession } from "./store";
import type { PairingCode } from "@layp/shared";

export type SyncOutcome = { ok: true; at: string } | { ok: false; status: string; superseded?: boolean };

let inflight: AbortController | null = null;

export function abortSync(): void {
  inflight?.abort();
  inflight = null;
}

function begin(): AbortController {
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  return controller;
}

function superseded(): SyncOutcome {
  return { ok: false, status: "", superseded: true };
}

export function readPush(wait: boolean): Promise<SyncRequest> {
  return withLock((run) => pushRequest(run, wait));
}

export function applyRemote(response: SyncResponse): Promise<string> {
  return withLock((run) => applyRemoteWith(run, response));
}

export async function pairWithDesktop(code: PairingCode, name: string): Promise<{ ok: true; key: Uint8Array } | { ok: false; status: string }> {
  const response = await postText(`http://${code.host}:${code.port}/pair`, JSON.stringify({ secret: code.secret, name }), PAIR_TIMEOUT_MS);
  if (response.aborted || response.status === 0) return { ok: false, status: UNREACHABLE };
  if (response.status !== 200) return { ok: false, status: pairFailure(response.status) };
  try {
    const parsed = parsePairResponse(JSON.parse(response.body));
    const key = parsed ? decodeKey(parsed.key) : null;
    if (!parsed || parsed.phoneId !== "phone" || !key) return { ok: false, status: UNREACHABLE };
    return { ok: true, key };
  } catch {
    return { ok: false, status: UNREACHABLE };
  }
}

/** Hardcoded zero cursors. Empty `changesSince` on a fresh database is not this request. */
export function syncInitial(): Promise<SyncOutcome> {
  return postSync(initialSyncRequest(), begin());
}

export async function syncOnce(wait: boolean): Promise<SyncOutcome> {
  const controller = begin();
  try {
    const session = await loadSession();
    if (controller.signal.aborted) return superseded();
    if (!session) return { ok: false, status: UNPAIRED };
    const request = await readPush(wait);
    if (controller.signal.aborted) return superseded();
    return await postSync(request, controller);
  } catch {
    if (controller.signal.aborted) return superseded();
    return { ok: false, status: UNREACHABLE };
  } finally {
    if (inflight === controller) inflight = null;
  }
}

async function postSync(request: SyncRequest, controller: AbortController): Promise<SyncOutcome> {
  const session = await loadSession();
  if (!session) return { ok: false, status: UNPAIRED };
  try {
    const body = sealJson(session.key, request);
    const response = await postText(`http://${session.host}:${session.port}/sync`, body, SYNC_TIMEOUT_MS, controller.signal);
    if (response.aborted || controller.signal.aborted) return superseded();
    if (response.status !== 200) return { ok: false, status: syncFailure(response.status) };
    let parsed: SyncResponse | null = null;
    try {
      parsed = parseSyncResponse(openJson(session.key, response.body));
    } catch {
      return { ok: false, status: UNREACHABLE };
    }
    if (!parsed) return { ok: false, status: UNREACHABLE };
    if (controller.signal.aborted) return superseded();
    const at = await applyRemote(parsed);
    return { ok: true, at };
  } catch {
    if (controller.signal.aborted) return superseded();
    return { ok: false, status: UNREACHABLE };
  } finally {
    if (inflight === controller) inflight = null;
  }
}
