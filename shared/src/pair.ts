export type PairingCode = { version: 1; host: string; port: number; secret: string };

const SECRET_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Dotted IPv4. Each octet is 0–255. No hostname and no IPv6 literal. */
function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

export function formatPairingCode(code: PairingCode): string {
  return `layp:${code.version}:${code.host}:${code.port}:${code.secret}`;
}

/** One grammar: `layp:1:<ipv4>:<port>:<8 char secret>`. Anything else is null. */
export function parsePairingCode(text: string): PairingCode | null {
  const parts = text.split(":");
  if (parts.length !== 5) return null;
  const [prefix, version, host, portText, secret] = parts;
  if (prefix !== "layp" || version !== "1") return null;
  if (!isIpv4(host)) return null;
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (secret.length !== 8 || [...secret].some((char) => !SECRET_ALPHABET.includes(char))) return null;
  return { version: 1, host, port, secret };
}
