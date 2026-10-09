import { expect, it } from "vitest";
import { fallbackBytes, randomUUID } from "./random";

it("makes a unique nonce without Web Crypto", () => {
  const first = fallbackBytes(12);
  const second = fallbackBytes(12);
  expect(first).toHaveLength(12);
  expect(second).toHaveLength(12);
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
});

it("builds a uuid", () => {
  const id = randomUUID();
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
