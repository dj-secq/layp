import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { nowIso } from "../lib/clock";
import {
  cleanLog,
  cleanTrackerDraft,
  parseSchedule,
  serializeSchedule,
  type Schedule,
  type TrackerKind,
} from "../lib/journal";
import { STICKERS } from "../lib/stickers";
import { logFailure, query, run } from "./client";
import type { SaveResult } from "./types";

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
const workoutOrNull = z.preprocess(
  (value) => (value === "yes" || value === "no" ? value : null),
  z.enum(["yes", "no"]).nullable(),
);

export type Tracker = {
  id: string;
  name: string;
  kind: TrackerKind;
  unit: string | null;
  dailyTarget: number | null;
  color: string;
  isHobby: boolean;
  schedule: Schedule;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrackerLog = {
  id: string;
  trackerId: string;
  day: string;
  state: "done" | "skipped";
  value: number | null;
  note: string;
  updatedAt: string;
};

export type DaySnap = {
  day: string;
  mood: number | null;
  sleepHours: number | null;
  workout: "yes" | "no" | null;
};

const TRACKER_COLUMNS = `id, name, kind, unit, daily_target, color, is_hobby, schedule_json,
  sort_order, archived_at, created_at, updated_at`;

const LOG_COLUMNS = `id, tracker_id, day, state, value, note, updated_at`;

const trackerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["check", "count", "number", "scale", "minutes"]),
    unit: textOrNull,
    daily_target: numberOrNull,
    color: z.string(),
    is_hobby: flag,
    schedule_json: z.string(),
    sort_order: z.preprocess(asNumber, z.number()),
    archived_at: textOrNull,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform(
    (row): Tracker => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      unit: row.unit,
      dailyTarget: row.daily_target,
      color: row.color,
      isHobby: row.is_hobby,
      schedule: parseSchedule(row.schedule_json),
      sortOrder: row.sort_order,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

const logSchema = z
  .object({
    id: z.string(),
    tracker_id: z.string(),
    day: z.string(),
    state: z.enum(["done", "skipped"]),
    value: numberOrNull,
    note: z.string(),
    updated_at: z.string(),
  })
  .transform(
    (row): TrackerLog => ({
      id: row.id,
      trackerId: row.tracker_id,
      day: row.day,
      state: row.state,
      value: row.value,
      note: row.note,
      updatedAt: row.updated_at,
    }),
  );

const daySnapSchema = z
  .object({
    day: z.string(),
    mood: numberOrNull,
    sleep_hours: numberOrNull,
    workout: workoutOrNull,
  })
  .transform(
    (row): DaySnap => ({
      day: row.day,
      mood: row.mood === null ? null : Math.round(row.mood),
      sleepHours: row.sleep_hours,
      workout: row.workout,
    }),
  );

function parseTracker(row: unknown): Tracker {
  return trackerSchema.parse(row);
}

function parseLog(row: unknown): TrackerLog {
  return logSchema.parse(row);
}

function stickerHex(color: string): string | null {
  const hex = color.toLowerCase();
  return STICKERS.some((sticker) => sticker.hex === hex) ? hex : null;
}

async function getTracker(id: string): Promise<Tracker | null> {
  const rows = await query<unknown>(`SELECT ${TRACKER_COLUMNS} FROM trackers WHERE id = $1`, [id]);
  return rows[0] ? parseTracker(rows[0]) : null;
}

async function nextSortOrder(): Promise<number> {
  const maxRows = await query<{ max_sort: number | null }>(
    "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM trackers",
  );
  return Number(maxRows[0]?.max_sort ?? 0) + 1;
}

async function insertTracker(draft: {
  name: string;
  kind: TrackerKind;
  unit: string | null;
  dailyTarget: number | null;
  schedule: Schedule;
  color: string;
  isHobby: boolean;
}): Promise<SaveResult<Tracker>> {
  const id = crypto.randomUUID();
  const stamp = nowIso();
  try {
    const sortOrder = await nextSortOrder();
    await run(
      `INSERT INTO trackers (
         id, name, kind, unit, daily_target, color, is_hobby, schedule_json,
         sort_order, archived_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $10)`,
      [
        id,
        draft.name,
        draft.kind,
        draft.unit,
        draft.dailyTarget,
        draft.color,
        draft.isHobby ? 1 : 0,
        serializeSchedule(draft.schedule),
        sortOrder,
        stamp,
      ],
    );
    return {
      status: "saved",
      row: {
        id,
        name: draft.name,
        kind: draft.kind,
        unit: draft.unit,
        dailyTarget: draft.dailyTarget,
        color: draft.color,
        isHobby: draft.isHobby,
        schedule: draft.schedule,
        sortOrder,
        archivedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
    };
  } catch (err) {
    await logFailure("tracker save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function loadTrackers(includeArchived: boolean): Promise<Tracker[]> {
  const sql = includeArchived
    ? `SELECT ${TRACKER_COLUMNS} FROM trackers ORDER BY sort_order ASC, name ASC`
    : `SELECT ${TRACKER_COLUMNS} FROM trackers WHERE archived_at IS NULL ORDER BY sort_order ASC, name ASC`;
  const rows = await query<unknown>(sql);
  return rows.map(parseTracker);
}

export async function createTracker(input: {
  name: string;
  kind: TrackerKind;
  unit: string;
  target: string;
  schedule: Schedule;
  color: string;
}): Promise<SaveResult<Tracker>> {
  const cleaned = cleanTrackerDraft({
    name: input.name,
    kind: input.kind,
    unit: input.unit,
    target: input.target,
    schedule: input.schedule,
    hobby: false,
  });
  if (!cleaned.ok) return { status: "error", message: cleaned.error };
  const color = stickerHex(input.color);
  if (!color) return { status: "error", message: "Pick a color." };
  return insertTracker({
    name: cleaned.name,
    kind: cleaned.kind,
    unit: cleaned.unit,
    dailyTarget: cleaned.dailyTarget,
    schedule: cleaned.schedule,
    color,
    isHobby: false,
  });
}

export async function createHobby(name: string, color: string): Promise<SaveResult<Tracker>> {
  const cleaned = cleanTrackerDraft({
    name,
    kind: "minutes",
    unit: "",
    target: "",
    schedule: { type: "daily" },
    hobby: true,
  });
  if (!cleaned.ok) return { status: "error", message: cleaned.error };
  const hex = stickerHex(color);
  if (!hex) return { status: "error", message: "Pick a color." };
  return insertTracker({
    name: cleaned.name,
    kind: cleaned.kind,
    unit: cleaned.unit,
    dailyTarget: cleaned.dailyTarget,
    schedule: cleaned.schedule,
    color: hex,
    isHobby: true,
  });
}

async function setArchived(
  tracker: Tracker,
  archivedAt: string | null,
  stamp: string,
): Promise<SaveResult<Tracker>> {
  try {
    const affected = await run(
      `UPDATE trackers SET archived_at = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4`,
      [archivedAt, stamp, tracker.id, tracker.updatedAt],
    );
    if (affected === 0) {
      const current = await getTracker(tracker.id);
      if (!current) return { status: "error", message: "Not saved" };
      return { status: "conflict", current };
    }
    return { status: "saved", row: { ...tracker, archivedAt, updatedAt: stamp } };
  } catch (err) {
    await logFailure("tracker save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function archiveTracker(tracker: Tracker): Promise<SaveResult<Tracker>> {
  const stamp = nowIso();
  return setArchived(tracker, stamp, stamp);
}

export async function restoreTracker(tracker: Tracker): Promise<SaveResult<Tracker>> {
  return setArchived(tracker, null, nowIso());
}

export async function deleteHobby(tracker: Tracker, typedName: string): Promise<SaveResult<null>> {
  if (!tracker.isHobby) return { status: "error", message: "Only a hobby can be deleted." };
  if (typedName.trim() !== tracker.name) {
    return { status: "error", message: "Type the hobby name to delete it." };
  }
  try {
    const affected = await run(`DELETE FROM trackers WHERE id = $1 AND is_hobby = 1`, [tracker.id]);
    if (affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: null };
  } catch (err) {
    await logFailure("hobby delete failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function upsertLog(
  tracker: Tracker,
  day: string,
  input: { state: "done" | "skipped"; valueText: string; note: string },
): Promise<SaveResult<TrackerLog>> {
  const cleaned = cleanLog({
    kind: tracker.kind,
    state: input.state,
    valueText: input.valueText,
    note: input.note,
  });
  if (!cleaned.ok) return { status: "error", message: cleaned.error };
  const id = crypto.randomUUID();
  const stamp = nowIso();
  try {
    await run(
      `INSERT INTO tracker_logs (id, tracker_id, day, state, value, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(tracker_id, day) DO UPDATE SET
         state = excluded.state,
         value = excluded.value,
         note = excluded.note,
         updated_at = excluded.updated_at`,
      [id, tracker.id, day, cleaned.state, cleaned.value, cleaned.note, stamp],
    );
    const rows = await query<unknown>(
      `SELECT ${LOG_COLUMNS} FROM tracker_logs WHERE tracker_id = $1 AND day = $2`,
      [tracker.id, day],
    );
    if (!rows[0]) {
      await logFailure("tracker log save failed");
      return { status: "error", message: "Not saved" };
    }
    return { status: "saved", row: parseLog(rows[0]) };
  } catch (err) {
    await logFailure("tracker log save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function clearLog(trackerId: string, day: string): Promise<SaveResult<null>> {
  try {
    await run(`DELETE FROM tracker_logs WHERE tracker_id = $1 AND day = $2`, [trackerId, day]);
    return { status: "saved", row: null };
  } catch (err) {
    await logFailure("tracker log clear failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function logsBetween(from: string, to: string): Promise<TrackerLog[]> {
  const rows = await query<unknown>(
    `SELECT ${LOG_COLUMNS} FROM tracker_logs
     WHERE day >= $1 AND day <= $2
     ORDER BY day ASC, tracker_id ASC`,
    [from, to],
  );
  return rows.map(parseLog);
}

export async function logsForTracker(trackerId: string): Promise<TrackerLog[]> {
  const rows = await query<unknown>(
    `SELECT ${LOG_COLUMNS} FROM tracker_logs WHERE tracker_id = $1 ORDER BY day ASC`,
    [trackerId],
  );
  return rows.map(parseLog);
}

export async function hobbyNotes(
  trackerId: string,
  beforeDay: string | null,
  limit: number,
): Promise<TrackerLog[]> {
  const rows = await query<unknown>(
    `SELECT ${LOG_COLUMNS} FROM tracker_logs
     WHERE tracker_id = $1 AND state = 'done' AND note <> ''
       AND ($2 IS NULL OR day < $2)
     ORDER BY day DESC
     LIMIT $3`,
    [trackerId, beforeDay, limit],
  );
  return rows.map(parseLog);
}

export async function daysBetween(from: string, to: string): Promise<DaySnap[]> {
  const rows = await query<unknown>(
    `SELECT day, mood, sleep_hours, workout FROM days
     WHERE day >= $1 AND day <= $2
     ORDER BY day ASC`,
    [from, to],
  );
  return rows.map((row) => daySnapSchema.parse(row));
}

export async function completedDaysBetween(from: string, to: string): Promise<string[]> {
  const start = Temporal.PlainDate.from(from).subtract({ days: 2 }).toString();
  const end = Temporal.PlainDate.from(to).add({ days: 3 }).toString();
  const rows = await query<{ completed_at: unknown }>(
    `SELECT completed_at FROM tasks
     WHERE completed_at IS NOT NULL AND deleted_at IS NULL
       AND completed_at >= $1 AND completed_at < $2`,
    [start, end],
  );
  const zone = Temporal.Now.timeZoneId();
  const days = new Set<string>();
  for (const row of rows) {
    if (typeof row.completed_at !== "string") continue;
    try {
      const civil = Temporal.Instant.from(row.completed_at)
        .toZonedDateTimeISO(zone)
        .toPlainDate()
        .toString();
      if (civil >= from && civil <= to) days.add(civil);
    } catch {
      // Not an instant. The text window is only a prefilter.
    }
  }
  return [...days].sort();
}
