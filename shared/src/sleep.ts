const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseMinutes(value: string): number | null {
  const match = TIME.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Elapsed hours from bed to wake, including overnight. Equal times are 0. */
export function suggestedSleepHours(bed: string | null, wake: string | null): number | null {
  if (!bed || !wake) return null;
  const bedMinutes = parseMinutes(bed);
  const wakeMinutes = parseMinutes(wake);
  if (bedMinutes === null || wakeMinutes === null) return null;
  let diff = wakeMinutes - bedMinutes;
  if (diff < 0) diff += 24 * 60;
  const hours = Math.round((diff / 60) * 10) / 10;
  if (hours < 0 || hours > 24) return null;
  return hours;
}

export function formatHours(hours: number): string {
  return (Math.round(hours * 10) / 10).toFixed(1);
}

export function cleanSleep(input: string): { hours: number | null } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { hours: null };
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
    return { error: "Sleep hours are from 0 to 24." };
  }
  return { hours: Math.round(hours * 10) / 10 };
}
