import { beforeEach, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => memory.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    memory.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    memory.delete(key);
  },
}));

import { bytesToBase64 } from "./crypto";
import { STORE_HOST, STORE_KEY, STORE_PHONE, STORE_PORT, clearKey, loadSession, saveHost, savePair } from "./store";

const key = new Uint8Array(32).fill(4);

beforeEach(() => {
  memory.clear();
});

it("replaces the host and port and leaves the key", async () => {
  await savePair({ host: "192.168.1.20", port: 47321, key, phoneId: "phone" });
  const stored = memory.get(STORE_KEY);
  expect(stored).toBe(bytesToBase64(key));
  await saveHost("10.1.2.3", 47322);
  expect(memory.get(STORE_KEY)).toBe(stored);
  expect(memory.get(STORE_PHONE)).toBe("phone");
  const session = await loadSession();
  expect(session?.host).toBe("10.1.2.3");
  expect(session?.port).toBe(47322);
  expect(session?.key).toEqual(key);
  await clearKey();
  expect(memory.get(STORE_KEY)).toBeUndefined();
  expect(memory.get(STORE_PHONE)).toBeUndefined();
  expect(memory.get(STORE_HOST)).toBe("10.1.2.3");
  expect(memory.get(STORE_PORT)).toBe("47322");
  expect(await loadSession()).toBeNull();
});
