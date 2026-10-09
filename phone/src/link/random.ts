// Hermes on the phone has no Web Crypto. A repeated ChaCha20-Poly1305 nonce
// exposes the pairing key, so this fallback must not repeat a 12-byte nonce.
const session = Uint8Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
let counter = 0;

export function fallbackBytes(length: number): Uint8Array {
  counter = (counter + 1) >>> 0;
  const out = new Uint8Array(length);
  const now = BigInt(Date.now());
  const timeBytes = Math.min(6, length);
  for (let index = 0; index < timeBytes; index += 1) {
    out[index] = Number((now >> BigInt((5 - index) * 8)) & 0xffn);
  }
  const counterBytes = Math.min(4, length);
  const counterAt = length - counterBytes;
  for (let index = 0; index < counterBytes; index += 1) {
    out[counterAt + index] = (counter >> ((counterBytes - 1 - index) * 8)) & 0xff;
  }
  for (let index = timeBytes; index < counterAt; index += 1) {
    out[index] = session[index - timeBytes] ?? Math.floor(Math.random() * 256);
  }
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const web = globalThis.crypto;
  if (typeof web?.getRandomValues === "function") return web.getRandomValues(new Uint8Array(length));
  return fallbackBytes(length);
}

export function randomUUID(): string {
  const web = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof web?.randomUUID === "function") return web.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
