import { expect, it } from "vitest";
import { formatPairingCode, parsePairingCode } from "./pair";

const code = { version: 1 as const, host: "192.168.1.20", port: 47321, secret: "K7NQ4R2M" };

it("round-trips a pairing code", () => {
  expect(formatPairingCode(code)).toBe("layp:1:192.168.1.20:47321:K7NQ4R2M");
  expect(parsePairingCode("layp:1:192.168.1.20:47321:K7NQ4R2M")).toEqual(code);
});

it("rejects a missing prefix, a bad version, a short secret, a bad port, and a non-IPv4 host", () => {
  expect(parsePairingCode("192.168.1.20:47321:K7NQ4R2M")).toBeNull();
  expect(parsePairingCode("layp:2:192.168.1.20:47321:K7NQ4R2M")).toBeNull();
  expect(parsePairingCode("layp:1:192.168.1.20:47321:K7NQ")).toBeNull();
  expect(parsePairingCode("layp:1:192.168.1.20:port:K7NQ4R2M")).toBeNull();
  expect(parsePairingCode("layp:1:desktop.local:47321:K7NQ4R2M")).toBeNull();
  expect(parsePairingCode("layp:1:::1:47321:K7NQ4R2M")).toBeNull();
});
