import { ZERO_CURSOR } from "@layp/shared";
import { expect, it } from "vitest";
import {
  IDLE_BACKOFF_MS,
  PAIR_GRAMMAR,
  PAIR_REJECTED,
  PAIR_USED,
  UNPAIRED,
  UNREACHABLE,
  initialSyncRequest,
  nextIdleDelay,
  pairFailure,
  pairName,
  parseHostPort,
  parseSyncResponse,
  syncFailure,
} from "./protocol";

it("starts from the zero cursor and backs off only after a failure", () => {
  expect(initialSyncRequest()).toEqual({
    phoneId: "phone",
    have: ZERO_CURSOR,
    wantAck: ZERO_CURSOR,
    wait: false,
    rows: [],
    deletions: [],
  });
  expect(nextIdleDelay(true)).toBe(0);
  expect(nextIdleDelay(false)).toBe(IDLE_BACKOFF_MS);
  expect(IDLE_BACKOFF_MS).toBe(15_000);
});

it("maps 401 and 410 without treating every failure as unpaired", () => {
  expect(syncFailure(401)).toBe(UNPAIRED);
  expect(syncFailure(503)).toBe(UNREACHABLE);
  expect(syncFailure(0)).toBe(UNREACHABLE);
  expect(pairFailure(401)).toBe(PAIR_REJECTED);
  expect(pairFailure(410)).toBe(PAIR_USED);
  expect(pairFailure(500)).toBe(UNREACHABLE);
  expect(PAIR_GRAMMAR).toBe("Enter the full layp:1 code from the computer.");
  expect(UNPAIRED).toBe("This phone is not paired.");
  expect(UNREACHABLE).toBe("Computer not reachable");
});

it("accepts a dotted IPv4 and an integer port, and names the phone the way the desktop does", () => {
  expect(parseHostPort(" 192.168.1.20 ", "47321")).toEqual({ host: "192.168.1.20", port: 47321 });
  expect(parseHostPort("computer.local", "47321")).toBeNull();
  expect(parseHostPort("::1", "47321")).toBeNull();
  expect(parseHostPort("192.168.1.20", "0")).toBeNull();
  expect(pairName("  Kitchen  ")).toBe("Kitchen");
  expect(pairName("   ")).toBe("Phone");
  expect(pairName("x".repeat(41))).toBe("Phone");
});

it("rejects a sync body that is not the desktop shape", () => {
  expect(parseSyncResponse({ ack: { at: "", id: "" }, have: { at: "a", id: "b" }, rows: [], deletions: [] })).toEqual({
    ack: ZERO_CURSOR,
    have: { at: "a", id: "b" },
    rows: [],
    deletions: [],
  });
  expect(parseSyncResponse({ ack: { at: 1, id: "" }, have: ZERO_CURSOR, rows: [], deletions: [] })).toBeNull();
  expect(parseSyncResponse(null)).toBeNull();
});
