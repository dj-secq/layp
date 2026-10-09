import { changesSinceStatements, MAX_SYNC_BYTES, ZERO_CURSOR } from "@layp/shared";
import type { SyncResponse } from "../link/protocol";
import { expect, it } from "vitest";
import { applyRemoteWith, pushRequest } from "./apply";
import type { Run } from "./sql";

it("advances wantAck with the changesSince transaction clock", async () => {
  const run: Run = async (statements) => {
    if (statements.length === 1) {
      return {
        batches: [{ rows: [{ have_at: "", have_id: "", ack_at: "", ack_id: "" }], rowsAffected: 1 }],
        now: "2026-10-08T00:00:00.000Z",
      };
    }
    const batches = statements.map(() => ({ rows: [] as Record<string, unknown>[], rowsAffected: 0 }));
    batches[batches.length - 1] = {
      rows: [{ id: "del-1", entity: "tasks", entity_id: "task-1", deleted_at: "2099-01-01T00:00:00.000Z" }],
      rowsAffected: 1,
    };
    return { batches, now: "2099-01-01T00:00:01.000Z" };
  };
  const request = await pushRequest(run, true);
  expect(request.phoneId).toBe("phone");
  expect(request.have).toEqual(ZERO_CURSOR);
  expect(request.wait).toBe(true);
  expect(request.wantAck).toEqual({ at: "2099-01-01T00:00:00.000Z", id: "del-1" });
  expect(request.deletions).toEqual([{ id: "del-1", entity: "tasks", entityId: "task-1", deletedAt: "2099-01-01T00:00:00.000Z" }]);
});

it("applies as the phone, samples the changesSince clock, and stores the desktop echo", async () => {
  const calls: { sql: string; values: readonly (string | number | null)[] | undefined }[] = [];
  const response: SyncResponse = {
    ack: { at: "2026-02-02T00:00:00.000Z", id: "ack-1" },
    have: { at: "2026-03-03T00:00:00.000Z", id: "have-1" },
    rows: [
      {
        entity: "tags",
        id: "tag-1",
        updatedAt: "2026-03-03T00:00:00.000Z",
        row: {
          id: "tag-1",
          name: "Home",
          color: "#ffdc58",
          created_at: "2026-03-03T00:00:00.000Z",
          updated_at: "2026-03-03T00:00:00.000Z",
        },
      },
    ],
    deletions: [],
  };
  const run: Run = async (statements) => {
    calls.push(...statements.map((statement) => ({ sql: statement.sql, values: statement.values })));
    const first = statements[0]?.sql ?? "";
    if (first.includes("ack_at") && first.startsWith("SELECT")) {
      return { batches: [{ rows: [{ ack_at: "", ack_id: "" }], rowsAffected: 1 }], now: "not-the-clock" };
    }
    if (first.startsWith("PRAGMA")) {
      return { batches: statements.map(() => ({ rows: [], rowsAffected: 0 })), now: "apply-clock" };
    }
    if (first.startsWith("SELECT")) {
      expect(statements).toHaveLength(changesSinceStatements(ZERO_CURSOR).length);
      return { batches: statements.map(() => ({ rows: [], rowsAffected: 0 })), now: "2099-06-01T00:00:00.000Z" };
    }
    return { batches: [{ rows: [], rowsAffected: 1 }], now: "write-clock" };
  };
  const clock = await applyRemoteWith(run, response);
  expect(clock).toBe("2099-06-01T00:00:00.000Z");
  expect(calls.some((call) => /^\s*BEGIN/i.test(call.sql))).toBe(false);
  expect(calls.some((call) => call.sql.includes("excluded.updated_at >="))).toBe(true);
  expect(calls.some((call) => call.sql.includes("excluded.updated_at > "))).toBe(false);
  const update = calls.find((call) => call.sql.startsWith("UPDATE link_state"));
  expect(update?.values).toEqual(["2026-03-03T00:00:00.000Z", "have-1", "2026-02-02T00:00:00.000Z", "ack-1"]);
});

it("does not open a transaction when the payload is over the limit", async () => {
  let ran = false;
  const run: Run = async () => {
    ran = true;
    return { batches: [], now: "" };
  };
  const response: SyncResponse = {
    ack: ZERO_CURSOR,
    have: ZERO_CURSOR,
    rows: [
      {
        entity: "tags",
        id: "tag-1",
        updatedAt: "2026-03-03T00:00:00.000Z",
        row: { name: "x".repeat(MAX_SYNC_BYTES) },
      },
    ],
    deletions: [],
  };
  await expect(applyRemoteWith(run, response)).rejects.toThrow(/limit/);
  expect(ran).toBe(false);
});
