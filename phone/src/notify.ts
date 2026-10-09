import { reminderInstant } from "@layp/shared";
import type { Run, SqlStatement } from "./db/sql";

/** iOS keeps at most 64 pending local notifications. */
export const REMINDER_CAP = 64;
/** Instants past this wait for a later refresh. A year is not scheduled. */
export const REMINDER_DAYS = 7;
export const REMINDER_PREFIX = "layp:";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHANNEL_ID = "reminders";

export type DueReminder = {
  id: string;
  taskTitle: string;
  lineText: string | null;
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
};

export type PlannedReminder = {
  id: string;
  taskTitle: string;
  lineText: string | null;
  fireAt: string;
};

export type ReminderPlan = {
  fired: string[];
  scheduled: PlannedReminder[];
};

export type ScheduledNotice = {
  identifier: string;
  title: string;
  body: string;
  date: Date;
  channelId?: string;
};

export type NotificationPort = {
  pending: () => Promise<{ identifier: string }[]>;
  cancel: (identifier: string) => Promise<void>;
  schedule: (notice: ScheduledNotice) => Promise<void>;
  allow: () => Promise<boolean>;
};

const TASK_SQL = `SELECT r.id, t.title AS task_title, t.due_on, t.due_time, r.minutes_before
FROM reminders r
JOIN tasks t ON t.id = r.task_id
WHERE r.fired_at IS NULL
  AND t.completed_at IS NULL
  AND t.deleted_at IS NULL
  AND t.due_on IS NOT NULL`;

const CHECKLIST_SQL = `SELECT r.id, t.title AS task_title, r.line_text, r.due_on, r.due_time, r.minutes_before
FROM checklist_reminders r
JOIN tasks t ON t.id = r.task_id
WHERE r.fired_at IS NULL
  AND t.completed_at IS NULL
  AND t.deleted_at IS NULL`;

let chain: Promise<void> = Promise.resolve();
let onSync: (() => void) | null = null;
let arming: Promise<void> | null = null;
let subscription: { remove: () => void } | null = null;
let asked = false;
let deniedLogged = false;

/** Fire instants at or before `nowIso` are already due. The rest of the next seven days are scheduled soonest first, at most 64. */
export function planReminders(rows: DueReminder[], nowIso: string, timeZone: string): ReminderPlan {
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) return { fired: [], scheduled: [] };
  const horizonMs = nowMs + REMINDER_DAYS * DAY_MS;
  const fired: string[] = [];
  const upcoming: PlannedReminder[] = [];
  for (const row of rows) {
    let fireAt: string;
    try {
      fireAt = reminderInstant({
        dueOn: row.dueOn,
        dueTime: row.dueTime,
        minutesBefore: row.minutesBefore,
        timeZone,
      });
    } catch {
      continue;
    }
    const atMs = Date.parse(fireAt);
    if (Number.isNaN(atMs)) continue;
    if (atMs <= nowMs) {
      fired.push(row.id);
      continue;
    }
    if (atMs <= horizonMs) {
      upcoming.push({ id: row.id, taskTitle: row.taskTitle, lineText: row.lineText, fireAt });
    }
  }
  upcoming.sort((a, b) => {
    const byTime = Date.parse(a.fireAt) - Date.parse(b.fireAt);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { fired, scheduled: upcoming.slice(0, REMINDER_CAP) };
}

/** The notification body is the task title. A checklist line is the title so the line stays visible. */
export function notificationCopy(item: PlannedReminder): { title: string; body: string } {
  const line = item.lineText?.trim() ?? "";
  return { title: line.length > 0 ? line : "Layp", body: item.taskTitle };
}

export function notificationIdentifier(id: string): string {
  return `${REMINDER_PREFIX}${id}`;
}

export function reminderId(identifier: string): string | null {
  if (!identifier.startsWith(REMINDER_PREFIX)) return null;
  const id = identifier.slice(REMINDER_PREFIX.length);
  return id.length > 0 ? id : null;
}

export async function loadDueReminders(run: Run): Promise<DueReminder[]> {
  const result = await run([{ sql: TASK_SQL }, { sql: CHECKLIST_SQL }]);
  const tasks = (result.batches[0]?.rows ?? []).flatMap((row) => {
    const parsed = readDue(row, false);
    return parsed ? [parsed] : [];
  });
  const checks = (result.batches[1]?.rows ?? []).flatMap((row) => {
    const parsed = readDue(row, true);
    return parsed ? [parsed] : [];
  });
  return [...tasks, ...checks];
}

/** Sets `fired_at` only where it is still null, on both reminder tables. Returns whether a row changed. */
export async function markFiredOn(run: Run, ids: string[], stamp: string): Promise<boolean> {
  const statements = firedUpdates(ids, stamp);
  if (statements.length === 0) return false;
  const result = await run(statements);
  return result.batches.some((batch) => batch.rowsAffected > 0);
}

/**
 * Cancel pending `layp:` notifications, then schedule `items`.
 * Permission is asked only when there is something to schedule. A denial schedules nothing and leaves the previous queue.
 * The caller already capped `items` at 64, so a long list is not a denial.
 */
export async function replaceScheduled(port: NotificationPort, items: PlannedReminder[], channelId?: string): Promise<"ok" | "denied"> {
  if (items.length > 0) {
    const allowed = await port.allow();
    if (!allowed) return "denied";
  }
  const pending = await port.pending();
  for (const item of pending) {
    if (item.identifier.startsWith(REMINDER_PREFIX)) await port.cancel(item.identifier);
  }
  for (const item of items) {
    const date = new Date(item.fireAt);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) continue;
    const copy = notificationCopy(item);
    try {
      await port.schedule({
        identifier: notificationIdentifier(item.id),
        title: copy.title,
        body: copy.body,
        date,
        channelId,
      });
    } catch {
      // One rejected instant stays unfired for the next refresh. The title is not logged.
    }
  }
  return "ok";
}

/** Foreground delivery and the received listener. Safe to call more than once. */
export function startReminders(sync: () => void): () => void {
  onSync = sync;
  void armListener().catch(() => {
    console.error("reminder failed");
  });
  return () => {
    if (onSync === sync) onSync = null;
  };
}

/** Reload the seven-day queue. Failures stay off the diary screen. */
export function refreshReminders(): Promise<void> {
  const run = chain.then(refreshOnce).catch(() => {
    console.error("reminder failed");
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function refreshOnce(): Promise<void> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timeZone) throw new Error("reminder failed");
  const { withLock } = await import("./db/lock");
  const rows = await withLock(loadDueReminders);
  const plan = planReminders(rows, new Date().toISOString(), timeZone);
  await recordFired(plan.fired);
  const Notifications = await import("expo-notifications");
  await armListener();
  const { Platform } = await import("react-native");
  const channelId = Platform.OS === "android" ? CHANNEL_ID : undefined;
  const outcome = await replaceScheduled(expoPort(Notifications), plan.scheduled, channelId);
  if (outcome === "denied" && !deniedLogged) {
    deniedLogged = true;
    console.error("reminder failed");
  }
}

async function recordFired(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { withStamp } = await import("./db/lock");
  const changed = await withStamp((stamp, run) => markFiredOn(run, ids, stamp));
  if (changed) onSync?.();
}

function armListener(): Promise<void> {
  if (arming) return arming;
  arming = installListener().catch((err: unknown) => {
    arming = null;
    throw err;
  });
  return arming;
}

async function installListener(): Promise<void> {
  const Notifications = await import("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (subscription) return;
  subscription = Notifications.addNotificationReceivedListener((notification) => {
    const id = reminderId(notification.request.identifier);
    if (!id) return;
    void recordFired([id]).catch(() => {
      console.error("reminder failed");
    });
  });
}

function expoPort(Notifications: typeof import("expo-notifications")): NotificationPort {
  return {
    pending: () => Notifications.getAllScheduledNotificationsAsync(),
    cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
    schedule: async (notice) => {
      await Notifications.scheduleNotificationAsync({
        identifier: notice.identifier,
        content: { title: notice.title, body: notice.body, sound: true },
        trigger: notice.channelId
          ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notice.date, channelId: notice.channelId }
          : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notice.date },
      });
    },
    allow: async () => {
      const { Platform } = await import("react-native");
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: "Reminders",
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      const current = await Notifications.getPermissionsAsync();
      if (isGranted(Notifications, current)) return true;
      if (asked) return false;
      asked = true;
      const next = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: false, allowSound: true },
      });
      return isGranted(Notifications, next);
    },
  };
}

function isGranted(
  Notifications: typeof import("expo-notifications"),
  status: { granted: boolean; status: string; ios?: { status: number } },
): boolean {
  if (status.granted || status.status === "granted") return true;
  const ios = status.ios?.status;
  return (
    ios === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

function firedUpdates(ids: string[], stamp: string): SqlStatement[] {
  if (ids.length === 0) return [];
  const marks = ids.map((_, index) => `$${index + 2}`).join(", ");
  const values: (string | number | null)[] = [stamp, ...ids];
  return [
    {
      sql: `UPDATE reminders SET fired_at = $1, updated_at = $1 WHERE fired_at IS NULL AND id IN (${marks})`,
      values,
    },
    {
      sql: `UPDATE checklist_reminders SET fired_at = $1, updated_at = $1 WHERE fired_at IS NULL AND id IN (${marks})`,
      values,
    },
  ];
}

function readDue(row: Record<string, unknown>, checklist: boolean): DueReminder | null {
  if (typeof row.id !== "string" || typeof row.task_title !== "string" || typeof row.due_on !== "string") return null;
  const minutes = typeof row.minutes_before === "number" ? row.minutes_before : Number(row.minutes_before);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) return null;
  const dueTime = typeof row.due_time === "string" && row.due_time.length > 0 ? row.due_time : null;
  if (!checklist) return { id: row.id, taskTitle: row.task_title, lineText: null, dueOn: row.due_on, dueTime, minutesBefore: minutes };
  if (typeof row.line_text !== "string" || row.line_text.trim().length === 0) return null;
  return { id: row.id, taskTitle: row.task_title, lineText: row.line_text, dueOn: row.due_on, dueTime, minutesBefore: minutes };
}
