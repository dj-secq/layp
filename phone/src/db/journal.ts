import { z } from "zod";
import {
  cleanLog,
  cleanTrackerDraft,
  parseSchedule,
  serializeSchedule,
  STICKERS,
  type Schedule,
  type TrackerKind,
} from "@layp/shared";
import { randomUUID } from "../link/random";
import { withLock, withStamp } from "./lock";
import type { Run } from "./sql";

function asNumber(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

const flag = z
  .union([z.boolean(), z.number(), z.literal("0"), z.literal("1")])
  .transform((value) => value === true || value === 1 || value === "1");
const textOrNull = z.string().nullish().transform((value) => value ?? null);
const numberOrNull = z.preprocess((value) => (value === undefined ? null : asNumber(value)), z.number().nullable());
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

export type JournalSave<T> = { status: "saved"; row: T } | { status: "conflict"; current: T | null } | { status: "error"; message: string };

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

function stickerHex(color: string): string | null {
  const hex = color.toLowerCase();
  return STICKERS.some((sticker) => sticker.hex === hex) ? hex : null;
}

async function readTracker(run: Run, id: string): Promise<Tracker | null> {
  const loaded = await run([{ sql: `SELECT ${TRACKER_COLUMNS} FROM trackers WHERE id = $1`, values: [id] }]);
  const row = loaded.batches[0]?.rows[0];
  return row ? trackerSchema.parse(row) : null;
}

export function loadTrackers(includeArchived: boolean): Promise<Tracker[]> {
  const sql = includeArchived
    ? `SELECT ${TRACKER_COLUMNS} FROM trackers ORDER BY sort_order ASC, name ASC`
    : `SELECT ${TRACKER_COLUMNS} FROM trackers WHERE archived_at IS NULL ORDER BY sort_order ASC, name ASC`;
  return withLock(async (run) => {
    const loaded = await run([{ sql, values: [] }]);
    return (loaded.batches[0]?.rows ?? []).map((row) => trackerSchema.parse(row));
  });
}

export async function createTracker(input: {
  name: string;
  kind: TrackerKind;
  unit: string;
  target: string;
  schedule: Schedule;
  color: string;
}): Promise<JournalSave<Tracker>> {
  const cleaned = cleanTrackerDraft({ ...input, hobby: false });
  if (!cleaned.ok) return { status: "error", message: cleaned.error };
  const color = stickerHex(input.color);
  if (!color) return { status: "error", message: "Pick a color." };
  try {
    return await withStamp((stamp, run) =>
      insertTrackerOn(run, { ...cleaned, color, isHobby: false }, stamp, randomUUID()),
    );
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function insertTrackerOn(
  run: Run,
  draft: {
    name: string;
    kind: TrackerKind;
    unit: string | null;
    dailyTarget: number | null;
    schedule: Schedule;
    color: string;
    isHobby: boolean;
  },
  stamp: string,
  id: string,
): Promise<JournalSave<Tracker>> {
  const max = await run([{ sql: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM trackers`, values: [] }]);
  const sortOrder = Number(max.batches[0]?.rows[0]?.max_sort ?? 0) + 1;
  await run([
    {
      sql: `INSERT INTO trackers (
         id, name, kind, unit, daily_target, color, is_hobby, schedule_json,
         sort_order, archived_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $10)`,
      values: [
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
    },
  ]);
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
}

export async function updateTracker(
  tracker: Tracker,
  input: { name: string; kind: TrackerKind; unit: string; target: string; schedule: Schedule; color: string },
): Promise<JournalSave<Tracker>> {
  if (tracker.isHobby) return { status: "error", message: "Not saved" };
  const cleaned = cleanTrackerDraft({ ...input, hobby: false });
  if (!cleaned.ok) return { status: "error", message: cleaned.error };
  const color = stickerHex(input.color);
  if (!color) return { status: "error", message: "Pick a color." };
  try {
    return await withStamp((stamp, run) => updateTrackerOn(run, tracker, { ...cleaned, color }, stamp));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function updateTrackerOn(
  run: Run,
  tracker: Tracker,
  cleaned: { name: string; kind: TrackerKind; unit: string | null; dailyTarget: number | null; schedule: Schedule; color: string },
  stamp: string,
): Promise<JournalSave<Tracker>> {
  const counted = await run([{ sql: `SELECT COUNT(*) AS count FROM tracker_logs WHERE tracker_id = $1`, values: [tracker.id] }]);
  const logCount = Number(counted.batches[0]?.rows[0]?.count ?? 0);
  if (logCount > 0 && cleaned.kind !== tracker.kind) return { status: "error", message: "Kind stays after the first log." };
  const schedule = serializeSchedule(cleaned.schedule);
  const saved =
    logCount === 0
      ? await run([
          {
            sql: `UPDATE trackers
               SET name = $1, kind = $2, unit = $3, daily_target = $4, color = $5, schedule_json = $6, updated_at = $7
             WHERE id = $8 AND updated_at = $9`,
            values: [cleaned.name, cleaned.kind, cleaned.unit, cleaned.dailyTarget, cleaned.color, schedule, stamp, tracker.id, tracker.updatedAt],
          },
        ])
      : await run([
          {
            sql: `UPDATE trackers
               SET name = $1, unit = $2, daily_target = $3, color = $4, schedule_json = $5, updated_at = $6
             WHERE id = $7 AND updated_at = $8`,
            values: [cleaned.name, cleaned.unit, cleaned.dailyTarget, cleaned.color, schedule, stamp, tracker.id, tracker.updatedAt],
          },
        ]);
  if ((saved.batches[0]?.rowsAffected ?? 0) === 0) {
    const current = await readTracker(run, tracker.id);
    if (!current) return { status: "error", message: "Not saved" };
    return { status: "conflict", current };
  }
  return {
    status: "saved",
    row: { ...tracker, name: cleaned.name, kind: logCount === 0 ? cleaned.kind : tracker.kind, unit: cleaned.unit, dailyTarget: cleaned.dailyTarget, color: cleaned.color, schedule: cleaned.schedule, updatedAt: stamp },
  };
}

export async function createHobby(name: string, color: string): Promise<JournalSave<Tracker>> {
  const cleaned = cleanTrackerDraft({ name, kind: "minutes", unit: "", target: "", schedule: { type: "daily" }, hobby: true });
  if (!cleaned.ok) return { status: "error", message: cleaned.error };
  const hex = stickerHex(color);
  if (!hex) return { status: "error", message: "Pick a color." };
  try {
    return await withStamp((stamp, run) => insertTrackerOn(run, { ...cleaned, color: hex, isHobby: true }, stamp, randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function updateHobby(tracker: Tracker, name: string, color: string): Promise<JournalSave<Tracker>> {
  if (!tracker.isHobby || tracker.kind !== "minutes") return { status: "error", message: "Not saved" };
  const cleaned = cleanTrackerDraft({ name, kind: "minutes", unit: "", target: "", schedule: { type: "daily" }, hobby: true });
  if (!cleaned.ok) return { status: "error", message: cleaned.error };
  const hex = stickerHex(color);
  if (!hex) return { status: "error", message: "Pick a color." };
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        {
          sql: `UPDATE trackers SET name = $1, color = $2, updated_at = $3
                WHERE id = $4 AND updated_at = $5 AND is_hobby = 1 AND kind = 'minutes'`,
          values: [cleaned.name, hex, stamp, tracker.id, tracker.updatedAt],
        },
      ]);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0) {
        const current = await readTracker(run, tracker.id);
        if (!current) return { status: "error" as const, message: "Not saved" };
        return { status: "conflict" as const, current };
      }
      return { status: "saved" as const, row: { ...tracker, name: cleaned.name, color: hex, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

async function setArchived(tracker: Tracker, archived: boolean): Promise<JournalSave<Tracker>> {
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        {
          sql: `UPDATE trackers SET archived_at = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4`,
          values: [archived ? stamp : null, stamp, tracker.id, tracker.updatedAt],
        },
      ]);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0) {
        const current = await readTracker(run, tracker.id);
        if (!current) return { status: "error" as const, message: "Not saved" };
        return { status: "conflict" as const, current };
      }
      return { status: "saved" as const, row: { ...tracker, archivedAt: archived ? stamp : null, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export function archiveTracker(tracker: Tracker): Promise<JournalSave<Tracker>> {
  return setArchived(tracker, true);
}

export function restoreTracker(tracker: Tracker): Promise<JournalSave<Tracker>> {
  return setArchived(tracker, false);
}

export async function deleteHobby(tracker: Tracker, typedName: string): Promise<JournalSave<null>> {
  if (!tracker.isHobby) return { status: "error", message: "Only a hobby can be deleted." };
  if (typedName.trim() !== tracker.name) return { status: "error", message: "Type the hobby name to delete it." };
  try {
    const saved = await withStamp(async (stamp, run) => {
      const rows = await run([{ sql: `SELECT id FROM trackers WHERE id = $1 AND is_hobby = 1`, values: [tracker.id] }]);
      if ((rows.batches[0]?.rows.length ?? 0) === 0) return false;
      await run([
        {
          sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), "trackers", tracker.id, stamp],
        },
        { sql: `DELETE FROM trackers WHERE id = $1 AND is_hobby = 1`, values: [tracker.id] },
      ]);
      return true;
    });
    if (!saved) return { status: "error", message: "Not saved" };
    return { status: "saved", row: null };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function upsertLog(
  tracker: Tracker,
  day: string,
  input: { state: "done" | "skipped"; valueText: string; note: string },
): Promise<JournalSave<TrackerLog>> {
  const cleaned = cleanLog({ kind: tracker.kind, state: input.state, valueText: input.valueText, note: input.note });
  if (!cleaned.ok) return { status: "error", message: cleaned.error };
  try {
    return await withStamp((stamp, run) => upsertLogOn(run, tracker.id, day, cleaned, stamp, randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function upsertLogOn(
  run: Run,
  trackerId: string,
  day: string,
  cleaned: { state: "done" | "skipped"; value: number | null; note: string },
  stamp: string,
  id: string,
): Promise<JournalSave<TrackerLog>> {
  await run([
    {
      sql: `INSERT INTO tracker_logs (id, tracker_id, day, state, value, note, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT(tracker_id, day) DO UPDATE SET
              state = excluded.state,
              value = excluded.value,
              note = excluded.note,
              updated_at = excluded.updated_at`,
      values: [id, trackerId, day, cleaned.state, cleaned.value, cleaned.note, stamp],
    },
  ]);
  const rows = await run([{ sql: `SELECT ${LOG_COLUMNS} FROM tracker_logs WHERE tracker_id = $1 AND day = $2`, values: [trackerId, day] }]);
  const row = rows.batches[0]?.rows[0];
  if (!row) return { status: "error", message: "Not saved" };
  return { status: "saved", row: logSchema.parse(row) };
}

export async function clearLog(trackerId: string, day: string): Promise<JournalSave<null>> {
  try {
    return await withStamp(async (stamp, run) => {
      const rows = await run([{ sql: `SELECT id FROM tracker_logs WHERE tracker_id = $1 AND day = $2`, values: [trackerId, day] }]);
      const logId = rows.batches[0]?.rows[0]?.id;
      if (typeof logId !== "string") return { status: "saved" as const, row: null };
      await run([
        {
          sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), "tracker_logs", logId, stamp],
        },
        { sql: `DELETE FROM tracker_logs WHERE id = $1`, values: [logId] },
      ]);
      return { status: "saved" as const, row: null };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export function logsBetween(from: string, to: string): Promise<TrackerLog[]> {
  return withLock(async (run) => {
    const loaded = await run([
      {
        sql: `SELECT ${LOG_COLUMNS} FROM tracker_logs WHERE day >= $1 AND day <= $2 ORDER BY day ASC, tracker_id ASC`,
        values: [from, to],
      },
    ]);
    return (loaded.batches[0]?.rows ?? []).map((row) => logSchema.parse(row));
  });
}

export function logsForTracker(trackerId: string): Promise<TrackerLog[]> {
  return withLock(async (run) => {
    const loaded = await run([
      { sql: `SELECT ${LOG_COLUMNS} FROM tracker_logs WHERE tracker_id = $1 ORDER BY day ASC`, values: [trackerId] },
    ]);
    return (loaded.batches[0]?.rows ?? []).map((row) => logSchema.parse(row));
  });
}

export function hobbyNotes(trackerId: string, beforeDay: string | null, limit: number): Promise<TrackerLog[]> {
  return withLock(async (run) => {
    const loaded = await run([
      {
        sql: `SELECT ${LOG_COLUMNS} FROM tracker_logs
              WHERE tracker_id = $1 AND state = 'done' AND note <> ''
                AND ($2 IS NULL OR day < $2)
              ORDER BY day DESC
              LIMIT $3`,
        values: [trackerId, beforeDay, limit],
      },
    ]);
    return (loaded.batches[0]?.rows ?? []).map((row) => logSchema.parse(row));
  });
}

export function daysBetween(from: string, to: string): Promise<DaySnap[]> {
  return withLock(async (run) => {
    const loaded = await run([
      {
        sql: `SELECT day, mood, sleep_hours, workout FROM days WHERE day >= $1 AND day <= $2 ORDER BY day ASC`,
        values: [from, to],
      },
    ]);
    return (loaded.batches[0]?.rows ?? []).map((row) => daySnapSchema.parse(row));
  });
}

export function trackerLogCounts(): Promise<Map<string, number>> {
  return withLock(async (run) => {
    const loaded = await run([{ sql: `SELECT tracker_id, COUNT(*) AS count FROM tracker_logs GROUP BY tracker_id`, values: [] }]);
    return new Map(
      (loaded.batches[0]?.rows ?? []).flatMap((row) =>
        typeof row.tracker_id === "string" ? [[row.tracker_id, Number(row.count)] as const] : [],
      ),
    );
  });
}

/** Civil dates of completed tasks in the range. The SQL window is a prefilter around the instants. */
export function completedDaysBetween(from: string, to: string): Promise<string[]> {
  return withLock(async (run) => {
    const loaded = await run([
      {
        sql: `SELECT completed_at FROM tasks
              WHERE completed_at IS NOT NULL AND deleted_at IS NULL
                AND completed_at >= $1 AND completed_at < $2`,
        values: [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`],
      },
    ]);
    const days = new Set<string>();
    for (const row of loaded.batches[0]?.rows ?? []) {
      if (typeof row.completed_at !== "string") continue;
      const date = new Date(row.completed_at);
      if (Number.isNaN(date.getTime())) continue;
      const civil = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (civil >= from && civil <= to) days.add(civil);
    }
    return [...days].sort();
  });
}

export function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(year, month, 0).getDate();
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}
