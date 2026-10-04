import { parseMinutes } from "./sleep";

export type ClockPreference = "12" | "24";

export function nowIso(): string {
  return new Date().toISOString();
}

/** Accept `23:30`, `7:05`, or `11:30 PM`. An empty field clears the time. Invalid text is null. */
export function parseClock(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const plain = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  if (plain) {
    const hour = Number(plain[1]);
    if (hour > 23) return null;
    return `${String(hour).padStart(2, "0")}:${plain[2]}`;
  }
  const twelve = /^(\d{1,2}):([0-5]\d)\s*([ap])\.?m\.?$/i.exec(trimmed);
  if (!twelve) return null;
  let hour = Number(twelve[1]);
  if (hour < 1 || hour > 12) return null;
  const pm = twelve[3].toLowerCase() === "p";
  if (!pm) hour = hour === 12 ? 0 : hour;
  else if (hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${twelve[2]}`;
}

export function formatClock(hhmm: string, clock: ClockPreference): string {
  const minutes = parseMinutes(hhmm);
  if (minutes === null) return hhmm;
  const hour = Math.floor(minutes / 60);
  const minute = String(minutes % 60).padStart(2, "0");
  if (clock === "24") return `${String(hour).padStart(2, "0")}:${minute}`;
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 || 12;
  return `${twelve}:${minute} ${suffix}`;
}
