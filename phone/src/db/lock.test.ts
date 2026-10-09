import { beforeEach, expect, it, vi } from "vitest";

const order = vi.hoisted(() => [] as string[]);

vi.mock("@layp/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@layp/shared")>();
  return {
    ...actual,
    nowIso: () => {
      order.push("now");
      return `t-${order.filter((item) => item === "now").length}`;
    },
  };
});

vi.mock("./open", () => ({
  openPhoneDatabase: async () => ({
    withTransactionAsync: async (task: () => Promise<void>) => {
      order.push("tx");
      await task();
    },
    getAllAsync: async () => {
      order.push("stmt");
      return [];
    },
    runAsync: async () => {
      order.push("stmt");
      return { changes: 0, lastInsertRowId: 0 };
    },
  }),
}));

import { withLock, withStamp } from "./lock";

beforeEach(() => {
  order.length = 0;
});

it("samples nowIso after the previous holder and before run", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withLock(async () => {
    order.push("hold");
    await gate;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = withStamp(async (stamp, run) => {
    order.push(`stamp:${stamp}`);
    await run([{ sql: "SELECT 1", values: [] }]);
  });
  expect(order).toEqual(["hold"]);
  release();
  await first;
  await second;
  expect(order).toEqual(["hold", "now", "stamp:t-1", "tx", "stmt", "now"]);
});

it("does not let run take the queue, and a nested lock waits for the outer callback", async () => {
  const seen: string[] = [];
  await withLock(async (run) => {
    const inner = withLock(async () => {
      seen.push("inner");
    });
    await run([{ sql: "SELECT 1", values: [] }]);
    seen.push("after-run");
    const winner = await Promise.race([
      inner.then(() => "inner"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 40)),
    ]);
    expect(winner).toBe("timeout");
    expect(seen).toEqual(["after-run"]);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen).toEqual(["after-run", "inner"]);
});
