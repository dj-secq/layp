import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { expect, it } from "vitest";
import { bytesToBase64, openJson, sealBytes, sealJson } from "./crypto";

const key = new Uint8Array(32).fill(7);
const nonce = new Uint8Array(12).fill(9);
const plain = new TextEncoder().encode('{"phoneId":"phone"}');

it("round-trips ChaCha20-Poly1305 with the layp-sync-v1 AAD and a {v,n,c} body", () => {
  const cipher = sealBytes(key, nonce, plain);
  const body = JSON.stringify({ v: 1, n: bytesToBase64(nonce), c: bytesToBase64(cipher) });
  expect(JSON.parse(body)).toMatchObject({ v: 1 });
  expect(openJson(key, body)).toEqual({ phoneId: "phone" });
  const wire = JSON.parse(sealJson(key, { phoneId: "phone" })) as { v: number; n: string; c: string };
  expect(wire.v).toBe(1);
  expect(typeof wire.n).toBe("string");
  expect(typeof wire.c).toBe("string");
  expect(openJson(key, JSON.stringify(wire))).toEqual({ phoneId: "phone" });
});

it("rejects a flipped ciphertext byte and a different AAD", () => {
  const cipher = sealBytes(key, nonce, plain);
  cipher[0] ^= 0x01;
  const flipped = JSON.stringify({ v: 1, n: bytesToBase64(nonce), c: bytesToBase64(cipher) });
  expect(() => openJson(key, flipped)).toThrow();

  const other = chacha20poly1305(key, nonce, new TextEncoder().encode("other")).encrypt(plain);
  const wrongAad = JSON.stringify({ v: 1, n: bytesToBase64(nonce), c: bytesToBase64(other) });
  expect(() => openJson(key, wrongAad)).toThrow();
});

it("matches standard base64", () => {
  expect(bytesToBase64(nonce)).toBe(Buffer.from(nonce).toString("base64"));
  expect(bytesToBase64(key)).toBe(Buffer.from(key).toString("base64"));
});
