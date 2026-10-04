import { MOOD_COLORS } from "./stickers";

export const yearModes = ["mood", "shown", "sleep", "workout", "tasks", "hobby"] as const;
export type YearMode = (typeof yearModes)[number];

export const YEAR_MODE_LABELS: Record<YearMode, string> = {
  mood: "Mood",
  shown: "Shown up",
  sleep: "Sleep",
  workout: "Workout",
  tasks: "Tasks",
  hobby: "Hobby",
};

const SHOWN = "#ffdc58";
const SLEEP = "#7dd3fc";
const WORKOUT = "#86efac";
const TASKS = "#ffdc58";

export function yearBarColor(input: {
  mode: YearMode;
  mood: number | null;
  shown: boolean;
  sleepHours: number | null;
  workoutYes: boolean;
  taskCompleted: boolean;
  hobbyColor: string | null;
}): string | null {
  switch (input.mode) {
    case "mood":
      return input.mood && input.mood >= 1 && input.mood <= 5 ? MOOD_COLORS[input.mood - 1] : null;
    case "shown":
      return input.shown ? SHOWN : null;
    case "sleep":
      return input.sleepHours === null ? null : SLEEP;
    case "workout":
      return input.workoutYes ? WORKOUT : null;
    case "tasks":
      return input.taskCompleted ? TASKS : null;
    case "hobby":
      return input.hobbyColor;
  }
}

export function sleepRangeLabel(hours: Array<number | null>): string {
  const values = hours.filter((value): value is number => value !== null);
  if (values.length === 0) return "No sleep recorded";
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return `${low.toFixed(1)} hours`;
  return `${low.toFixed(1)}–${high.toFixed(1)} hours`;
}
