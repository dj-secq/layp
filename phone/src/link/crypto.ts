import { chacha20poly1305 } from "@noble/ciphers/chacha.js";

const AAD = new TextEncoder().encode("layp-sync-v1");

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = index + 1 < bytes.length ? (bytes[index + 1] ?? 0) : 0;
    const third = index + 2 < bytes.length ? (bytes[index + 2] ?? 0) : 0;
    const triple = (first << 16) | (second << 8) | third;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    out += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = text.replace(/\s/g, "");
  if (clean.length === 0 || clean.length % 4 !== 0) throw new Error("bad base64");
  const out: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index] ?? "");
    const b = alphabet.indexOf(clean[index + 1] ?? "");
    const cChar = clean[index + 2] ?? "";
    const dChar = clean[index + 3] ?? "";
    const c = cChar === "=" ? -1 : alphabet.indexOf(cChar);
    const d = dChar === "=" ? -1 : alphabet.indexOf(dChar);
    if (a < 0 || b < 0 || (c < 0 && cChar !== "=") || (d < 0 && dChar !== "=")) throw new Error("bad base64");
    const triple = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out.push((triple >> 16) & 255);
    if (c >= 0) out.push((triple >> 8) & 255);
    if (d >= 0) out.push(triple & 255);
  }
  return Uint8Array.from(out);
}

export function decodeKey(text: string): Uint8Array | null {
  try {
    const key = base64ToBytes(text);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function sealJson(key: Uint8Array, value: unknown): string {
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = chacha20poly1305(key, nonce, AAD).encrypt(plain);
  return JSON.stringify({ v: 1, n: bytesToBase64(nonce), c: bytesToBase64(cipher) });
}

export function openJson(key: Uint8Array, body: string): unknown {
  const parsed = JSON.parse(body) as { v?: unknown; n?: unknown; c?: unknown };
  if (parsed.v !== 1 || typeof parsed.n !== "string" || typeof parsed.c !== "string") throw new Error("bad wire");
  const nonce = base64ToBytes(parsed.n);
  const cipher = base64ToBytes(parsed.c);
  if (nonce.length !== 12) throw new Error("bad nonce");
  const plain = chacha20poly1305(key, nonce, AAD).decrypt(cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Fixed-nonce seal used to match the desktop vector. The live client uses `sealJson`. */
export function sealBytes(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonce, AAD).encrypt(plain);
}
