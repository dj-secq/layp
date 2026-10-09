import { z } from "zod";

function asNumber(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

const flag = z
  .union([z.boolean(), z.number(), z.literal("0"), z.literal("1")])
  .transform((value) => value === true || value === 1 || value === "1");
const textOrNull = z.string().nullish().transform((value) => value ?? null);
const numberOrNull = z.preprocess(
  (value) => (value === undefined ? null : asNumber(value)),
  z.number().nullable(),
);

export const taskSchema = z
  .object({
    id: z.string(),
    series_id: z.string(),
    list_id: z.string(),
    section_id: textOrNull,
    parent_id: textOrNull,
    title: z.string(),
    notes: z.string(),
    priority: z.enum(["none", "low", "medium", "high"]),
    important: flag,
    urgent: flag,
    pinned: flag,
    start_on: textOrNull,
    due_on: textOrNull,
    due_time: textOrNull,
    duration_minutes: numberOrNull,
    recurrence_json: textOrNull,
    estimated_pomos: numberOrNull,
    completed_pomos: z.preprocess(asNumber, z.number().default(0)),
    sort_order: z.preprocess(asNumber, z.number()),
    completed_at: textOrNull,
    deleted_at: textOrNull,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    seriesId: row.series_id,
    listId: row.list_id,
    sectionId: row.section_id,
    parentId: row.parent_id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    important: row.important,
    urgent: row.urgent,
    pinned: row.pinned,
    startOn: row.start_on,
    dueOn: row.due_on,
    dueTime: row.due_time,
    durationMinutes: row.duration_minutes,
    recurrenceJson: row.recurrence_json,
    estimatedPomos: row.estimated_pomos,
    completedPomos: row.completed_pomos,
    sortOrder: row.sort_order,
    completedAt: row.completed_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

export type Task = z.infer<typeof taskSchema>;
export type Priority = Task["priority"];

export const listSchema = z
  .object({
    id: z.string(),
    folder_id: textOrNull,
    name: z.string(),
    color: z.string(),
    sort_order: z.preprocess(asNumber, z.number()),
    archived_at: textOrNull,
    is_inbox: flag,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    isInbox: row.is_inbox,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

export type TaskList = z.infer<typeof listSchema>;

export const sectionSchema = z
  .object({
    id: z.string(),
    list_id: z.string(),
    name: z.string(),
    sort_order: z.preprocess(asNumber, z.number()),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    listId: row.list_id,
    name: row.name,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  }));

export type Section = z.infer<typeof sectionSchema>;

export const daySchema = z
  .object({
    day: z.string(),
    diary: z.string(),
    mood: numberOrNull,
    sleep_hours: numberOrNull,
    sleep_bed: textOrNull,
    sleep_wake: textOrNull,
    workout: z.enum(["yes", "no"]).nullish().transform((value) => value ?? null),
    workout_note: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    day: row.day,
    diary: row.diary,
    mood: row.mood === null ? null : Math.round(row.mood),
    sleepHours: row.sleep_hours,
    sleepBed: row.sleep_bed,
    sleepWake: row.sleep_wake,
    workout: row.workout,
    workoutNote: row.workout_note,
    updatedAt: row.updated_at,
  }));

export type Day = z.infer<typeof daySchema>;

export const tagSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

export type Tag = z.infer<typeof tagSchema>;

export const reminderSchema = z
  .object({
    id: z.string(),
    task_id: z.string(),
    minutes_before: z.preprocess(asNumber, z.number()),
    fired_at: textOrNull,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    taskId: row.task_id,
    minutesBefore: row.minutes_before,
    firedAt: row.fired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

export type Reminder = z.infer<typeof reminderSchema>;

export const countdownSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    target_on: z.string(),
    sort_order: z.preprocess(asNumber, z.number()),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    title: row.title,
    targetOn: row.target_on,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

export type Countdown = z.infer<typeof countdownSchema>;

export const settingsRowSchema = z
  .object({
    key: z.string(),
    value: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  }));

export type SettingsRow = z.infer<typeof settingsRowSchema>;

export const focusSessionSchema = z
  .object({
    id: z.string(),
    task_id: textOrNull,
    started_at: z.string(),
    ended_at: z.string(),
    minutes: z.preprocess(asNumber, z.number()),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    minutes: row.minutes,
    updatedAt: row.updated_at,
  }));

export type FocusSession = z.infer<typeof focusSessionSchema>;
