import type { Day, FocusSound } from "@layp/shared";

export {
  countdownSchema,
  daySchema,
  focusSessionSchema,
  listSchema,
  reminderSchema,
  sectionSchema,
  settingsRowSchema,
  tagSchema,
  taskSchema,
} from "@layp/shared";
export type {
  Countdown,
  Day,
  FocusSession,
  Priority,
  Reminder,
  Section,
  SettingsRow,
  Tag,
  Task,
  TaskList,
} from "@layp/shared";

export const themeNames = ["light", "dark", "dusk", "ink", "sage", "sea", "bloom", "slate"] as const;
export type ThemeName = (typeof themeNames)[number];

export function isThemeName(value: string | undefined): value is ThemeName {
  return themeNames.some((name) => name === value);
}

export type Settings = {
  theme: ThemeName;
  weekStart: "monday" | "sunday";
  closeBehavior: "quit" | "tray";
  quickAddShortcut: string;
  pomoWorkMinutes: number;
  pomoBreakMinutes: number;
  pomoSoundWork: FocusSound;
  pomoSoundBreak: FocusSound;
  clock: "12" | "24";
  phoneLink: boolean;
};

export const defaultSettings: Settings = {
  theme: "light",
  weekStart: "monday",
  closeBehavior: "quit",
  quickAddShortcut: "Ctrl+Shift+Space",
  pomoWorkMinutes: 25,
  pomoBreakMinutes: 5,
  pomoSoundWork: "bell",
  pomoSoundBreak: "bell",
  clock: "12",
  phoneLink: false,
};

export type SaveResult<T> =
  | { status: "saved"; row: T }
  | { status: "conflict"; current: T | null }
  | { status: "error"; message: string };

export function emptyDay(day: string): Day {
  return {
    day,
    diary: "",
    mood: null,
    sleepHours: null,
    sleepBed: null,
    sleepWake: null,
    workout: null,
    workoutNote: "",
    updatedAt: "",
  };
}
