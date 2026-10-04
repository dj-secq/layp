import { logFailure, query, run } from "./client";
import { parseFocusSound } from "../lib/focusSound";
import { defaultSettings, isThemeName, type Settings } from "./types";

const KEYS = {
  theme: "theme",
  weekStart: "week_start",
  closeBehavior: "close_behavior",
  quickAddShortcut: "quick_add_shortcut",
  pomoWorkMinutes: "pomo_work_minutes",
  pomoBreakMinutes: "pomo_break_minutes",
  pomoSoundWork: "pomo_sound_work",
  pomoSoundBreak: "pomo_sound_break",
  clock: "clock",
} as const;

export async function loadSettings(): Promise<Settings> {
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings");
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const theme = values.get(KEYS.theme);
  const weekStart = values.get(KEYS.weekStart);
  const closeBehavior = values.get(KEYS.closeBehavior);
  const clock = values.get(KEYS.clock);
  const work = Number(values.get(KEYS.pomoWorkMinutes));
  const breakMinutes = Number(values.get(KEYS.pomoBreakMinutes));
  return {
    theme: isThemeName(theme) ? theme : "light",
    weekStart: weekStart === "sunday" ? "sunday" : "monday",
    closeBehavior: closeBehavior === "tray" ? "tray" : "quit",
    quickAddShortcut: values.get(KEYS.quickAddShortcut) || defaultSettings.quickAddShortcut,
    pomoWorkMinutes: Number.isFinite(work) ? work : defaultSettings.pomoWorkMinutes,
    pomoBreakMinutes: Number.isFinite(breakMinutes) ? breakMinutes : defaultSettings.pomoBreakMinutes,
    pomoSoundWork: parseFocusSound(values.get(KEYS.pomoSoundWork)),
    pomoSoundBreak: parseFocusSound(values.get(KEYS.pomoSoundBreak)),
    clock: clock === "24" ? "24" : "12",
  };
}

export async function saveSetting(key: keyof typeof KEYS, value: string): Promise<void> {
  try {
    await run(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [KEYS[key], value],
    );
  } catch (err) {
    await logFailure("settings save failed");
    throw err;
  }
}
