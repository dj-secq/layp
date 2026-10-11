import { clampPomoMinutes, parseFocusSound, parseSnippets, type ClockPreference, type FocusSound, type QuickSnippet, type WeekStart } from "@layp/shared";
import { isThemeName, type ThemeName } from "../theme/paper";
import { withLock, withStamp } from "./lock";
import type { Run } from "./sql";

export type PhoneSettings = {
  theme: ThemeName;
  weekStart: WeekStart;
  pomoWorkMinutes: number;
  pomoBreakMinutes: number;
  pomoSoundWork: FocusSound;
  pomoSoundBreak: FocusSound;
  clock: ClockPreference;
  quickSnippets: QuickSnippet[];
};

const SETTING_KEYS = {
  theme: "theme",
  weekStart: "week_start",
  pomoWorkMinutes: "pomo_work_minutes",
  pomoBreakMinutes: "pomo_break_minutes",
  pomoSoundWork: "pomo_sound_work",
  pomoSoundBreak: "pomo_sound_break",
  clock: "clock",
  quickSnippets: "quick_snippets",
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;

export async function readSettings(run: Run): Promise<PhoneSettings> {
  const loaded = await run([{ sql: `SELECT key, value FROM settings`, values: [] }]);
  const values = new Map<string, string>();
  for (const row of loaded.batches[0]?.rows ?? []) {
    if (typeof row.key === "string" && typeof row.value === "string") values.set(row.key, row.value);
  }
  const theme = values.get(SETTING_KEYS.theme);
  const weekStart = values.get(SETTING_KEYS.weekStart);
  const clock = values.get(SETTING_KEYS.clock);
  const work = Number(values.get(SETTING_KEYS.pomoWorkMinutes));
  const breakMinutes = Number(values.get(SETTING_KEYS.pomoBreakMinutes));
  return {
    theme: isThemeName(theme) ? theme : "light",
    weekStart: weekStart === "sunday" ? "sunday" : "monday",
    pomoWorkMinutes: Number.isFinite(work) ? clampPomoMinutes(work) : 25,
    pomoBreakMinutes: Number.isFinite(breakMinutes) ? clampPomoMinutes(breakMinutes) : 5,
    pomoSoundWork: parseFocusSound(values.get(SETTING_KEYS.pomoSoundWork)),
    pomoSoundBreak: parseFocusSound(values.get(SETTING_KEYS.pomoSoundBreak)),
    clock: clock === "24" ? "24" : "12",
    quickSnippets: parseSnippets(values.get(SETTING_KEYS.quickSnippets)),
  };
}

export function loadSettings(): Promise<PhoneSettings> {
  return withLock(readSettings);
}

export async function readClock(run: Run): Promise<ClockPreference> {
  const settings = await readSettings(run);
  return settings.clock;
}

export function loadClock(): Promise<ClockPreference> {
  return withLock(readClock);
}

export async function saveSetting(key: SettingKey, value: string): Promise<void> {
  await withStamp((stamp, run) => writeSetting(run, key, value, stamp));
}

export async function writeSetting(run: Run, key: SettingKey, value: string, stamp: string): Promise<void> {
  await run([
    {
      sql: `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      values: [SETTING_KEYS[key], value, stamp],
    },
  ]);
}
