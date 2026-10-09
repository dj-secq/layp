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
  /** Android clock delivery. Omitted on iOS. */
  delivery?: "alarmClock";
};

export type PendingNotice = {
  identifier: string;
  /** Epoch milliseconds, when the phone reports the armed instant. */
  fireAtMs?: number;
  /** Android delivery, when the phone reports it. */
  delivery?: string;
};

export type ScheduleResult = {
  status: "ok" | "denied";
  /** Already-due reminders that were shown. Failures stay out so they can be retried. */
  shown: string[];
};

export type NotificationPort = {
  pending: () => Promise<PendingNotice[]>;
  cancel: (identifier: string) => Promise<void>;
  schedule: (notice: ScheduledNotice) => Promise<void>;
  present: (notice: ScheduledNotice) => Promise<void>;
  allow: () => Promise<boolean>;
};

/** A past reminder newer than this is shown. Older ones are marked fired without a second alert. */
export const RECENT_DUE_MS = 12 * 60 * 60 * 1000;
/** An armed alarm within this window is the same instant. A real edit is farther away. */
const FIRE_SLOP_MS = 1500;
/** Let the system alert land before the in-app backup shows the same reminder. */
const LOCAL_GRACE_MS = 2000;
const MAX_TIMEOUT_MS = 2_147_483_647;

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
let exactAsked = false;
let deniedLogged = false;
let localTimer: ReturnType<typeof setTimeout> | null = null;

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

/** True when the armed notification is already the clock alarm for this instant. */
export function pendingStillMatches(pending: PendingNotice, wantMs: number, alarmClock: boolean): boolean {
  if (pending.fireAtMs === undefined || !Number.isFinite(pending.fireAtMs)) return false;
  if (Math.abs(pending.fireAtMs - wantMs) >= FIRE_SLOP_MS) return false;
  if (alarmClock && pending.delivery !== "alarmClock") return false;
  return true;
}

/** The soonest future reminder a live timer can wait for. A wait past the platform limit stays with the system alarm. */
export function nextReminder(items: PlannedReminder[], nowMs: number): PlannedReminder | null {
  let best: PlannedReminder | null = null;
  let bestAt = Infinity;
  for (const item of items) {
    const at = Date.parse(item.fireAt);
    if (Number.isNaN(at) || at <= nowMs) continue;
    if (at - nowMs > MAX_TIMEOUT_MS) continue;
    if (at < bestAt) {
      best = item;
      bestAt = at;
    }
  }
  return best;
}

/**
 * Past reminders still in the tray were already shown. A recent miss is shown now.
 * Anything older is recorded without another alert.
 */
export function splitPastReminders(
  rows: DueReminder[],
  firedIds: string[],
  presentedIds: ReadonlySet<string>,
  nowIso: string,
  timeZone: string,
): { show: PlannedReminder[]; quiet: string[] } {
  const nowMs = Date.parse(nowIso);
  const show: PlannedReminder[] = [];
  const quiet: string[] = [];
  if (Number.isNaN(nowMs)) return { show, quiet };
  for (const id of firedIds) {
    const row = rows.find((item) => item.id === id);
    if (!row) continue;
    if (presentedIds.has(notificationIdentifier(id))) {
      quiet.push(id);
      continue;
    }
    let fireAt = "";
    let atMs = Number.NaN;
    try {
      fireAt = reminderInstant({
        dueOn: row.dueOn,
        dueTime: row.dueTime,
        minutesBefore: row.minutesBefore,
        timeZone,
      });
      atMs = Date.parse(fireAt);
    } catch {
      atMs = Number.NaN;
    }
    if (Number.isFinite(atMs) && nowMs >= atMs && nowMs - atMs <= RECENT_DUE_MS) {
      show.push({ id, taskTitle: row.taskTitle, lineText: row.lineText, fireAt });
    } else {
      quiet.push(id);
    }
  }
  return { show, quiet };
}

/**
 * Keep a clock alarm that is already armed for the same instant.
 * Permission is asked only when there is something to schedule or show. A denial leaves the previous queue.
 * The caller already capped `items` at 64, so a long list is not a denial.
 */
export async function replaceScheduled(port: NotificationPort, items: PlannedReminder[], channelId?: string): Promise<ScheduleResult> {
  if (items.length > 0) {
    const allowed = await port.allow();
    if (!allowed) return { status: "denied", shown: [] };
  }
  const alarmClock = Boolean(channelId);
  const wanted = new Map<string, { item: PlannedReminder; at: number }>();
  const shown: string[] = [];
  for (const item of items) {
    const at = Date.parse(item.fireAt);
    if (Number.isNaN(at)) continue;
    if (at <= Date.now()) {
      const copy = notificationCopy(item);
      try {
        await port.present({
          identifier: notificationIdentifier(item.id),
          title: copy.title,
          body: copy.body,
          date: new Date(),
          channelId,
        });
        shown.push(item.id);
      } catch {
        // Leave it unfired so the next refresh can show it.
      }
      continue;
    }
    wanted.set(notificationIdentifier(item.id), { item, at });
  }
  const pending = await port.pending();
  for (const entry of pending) {
    if (!entry.identifier.startsWith(REMINDER_PREFIX)) continue;
    const want = wanted.get(entry.identifier);
    if (want && pendingStillMatches(entry, want.at, alarmClock)) {
      wanted.delete(entry.identifier);
      continue;
    }
    await port.cancel(entry.identifier);
  }
  for (const [identifier, wantedItem] of wanted) {
    const copy = notificationCopy(wantedItem.item);
    try {
      await port.schedule({
        identifier,
        title: copy.title,
        body: copy.body,
        date: new Date(wantedItem.at),
        channelId,
        delivery: alarmClock ? "alarmClock" : undefined,
      });
    } catch {
      // One rejected instant stays unfired for the next refresh. The title is not logged.
    }
  }
  return { status: "ok", shown };
}

/** A reminder that is already due still has to appear. Ids that were shown can be marked fired. */
export async function presentDue(port: NotificationPort, items: PlannedReminder[], channelId?: string): Promise<string[]> {
  if (items.length === 0) return [];
  const allowed = await port.allow();
  if (!allowed) return [];
  const shown: string[] = [];
  for (const item of items) {
    const copy = notificationCopy(item);
    try {
      await port.present({
        identifier: notificationIdentifier(item.id),
        title: copy.title,
        body: copy.body,
        date: new Date(),
        channelId,
      });
      shown.push(item.id);
    } catch {
      // Leave it unfired so the next refresh can show it.
    }
  }
  return shown;
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
  const nowIso = new Date().toISOString();
  const { withLock } = await import("./db/lock");
  const rows = await withLock(loadDueReminders);
  const plan = planReminders(rows, nowIso, timeZone);
  const Notifications = await import("expo-notifications");
  await armListener();
  const { Platform } = await import("react-native");
  const channelId = Platform.OS === "android" ? CHANNEL_ID : undefined;
  const port = expoPort(Notifications);
  let presented = new Set<string>();
  try {
    const visible = await Notifications.getPresentedNotificationsAsync();
    presented = new Set(visible.map((item) => item.request.identifier));
  } catch {
    // A missing tray read still shows a recent miss.
  }
  const past = splitPastReminders(rows, plan.fired, presented, nowIso, timeZone);
  const shown = await presentDue(port, past.show, channelId);
  const outcome = await replaceScheduled(port, plan.scheduled, channelId);
  await recordFired([...past.quiet, ...shown, ...outcome.shown]);
  if (outcome.status === "denied" && !deniedLogged) {
    deniedLogged = true;
    console.error("reminder failed");
  }
  armLocal(plan.scheduled, channelId);
}

/** While this screen is open, show the next reminder if the system alarm does not. */
function armLocal(items: PlannedReminder[], channelId?: string): void {
  if (localTimer) clearTimeout(localTimer);
  localTimer = null;
  const next = nextReminder(items, Date.now());
  if (!next) return;
  const delay = Math.max(0, Date.parse(next.fireAt) - Date.now());
  localTimer = setTimeout(() => {
    localTimer = null;
    const run = chain.then(() => deliverLocal(next, channelId)).catch(() => {
      console.error("reminder failed");
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
  }, delay);
}

async function deliverLocal(item: PlannedReminder, channelId?: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, LOCAL_GRACE_MS));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timeZone) return;
  const { withLock } = await import("./db/lock");
  const rows = await withLock(loadDueReminders);
  const row = rows.find((entry) => entry.id === item.id);
  if (!row) return;
  const nowIso = new Date().toISOString();
  const plan = planReminders([row], nowIso, timeZone);
  if (!plan.fired.includes(item.id)) {
    armLocal(plan.scheduled, channelId);
    return;
  }
  const Notifications = await import("expo-notifications");
  const port = expoPort(Notifications);
  let presented = false;
  try {
    const visible = await Notifications.getPresentedNotificationsAsync();
    presented = visible.some((entry) => entry.request.identifier === notificationIdentifier(item.id));
  } catch {
    presented = false;
  }
  if (presented) {
    await recordFired([item.id]);
    return;
  }
  try {
    await port.cancel(notificationIdentifier(item.id));
  } catch {
    // The system alarm is already gone.
  }
  const shown = await presentDue(port, [{ ...item, taskTitle: row.taskTitle, lineText: row.lineText, fireAt: nowIso }], channelId);
  await recordFired(shown);
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
    pending: async () => {
      const queued = await Notifications.getAllScheduledNotificationsAsync();
      return queued.map((request) => ({
        identifier: request.identifier,
        fireAtMs: triggerFireMs(request.trigger),
        delivery: triggerDelivery(request.trigger),
      }));
    },
    cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
    schedule: async (notice) => {
      await Notifications.scheduleNotificationAsync({
        identifier: notice.identifier,
        content: { title: notice.title, body: notice.body, sound: true },
        trigger: notice.channelId
          ? {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: notice.date,
              channelId: notice.channelId,
              delivery: notice.delivery,
            }
          : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notice.date },
      });
    },
    present: async (notice) => {
      await Notifications.scheduleNotificationAsync({
        identifier: notice.identifier,
        content: { title: notice.title, body: notice.body, sound: true, ...(notice.channelId ? { channelId: notice.channelId } : {}) },
        trigger: null,
      });
    },
    allow: async () => {
      const { Platform } = await import("react-native");
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: "Reminders",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
          enableVibrate: true,
          vibrationPattern: [0, 250, 250, 250],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }
      const current = await Notifications.getPermissionsAsync();
      const granted = isGranted(Notifications, current)
        ? true
        : asked
          ? false
          : await requestOnce(Notifications);
      if (granted && Platform.OS === "android") await ensureExactAlarm(Notifications);
      return granted;
    },
  };
}

async function requestOnce(Notifications: typeof import("expo-notifications")): Promise<boolean> {
  asked = true;
  const next = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return isGranted(Notifications, next);
}

/** Clock alarms fire on time. A phone that has not allowed them opens that setting once. */
async function ensureExactAlarm(Notifications: typeof import("expo-notifications")): Promise<void> {
  if (exactAsked) return;
  try {
    const exact = await Notifications.getExactAlarmPermissionsAsync();
    if (exact.granted) return;
    exactAsked = true;
    if (!exact.canAskAgain) return;
    await Notifications.requestExactAlarmPermissionsAsync();
  } catch {
    // The installed app may not declare the exact-alarm permission yet.
  }
}

function triggerFireMs(trigger: unknown): number | undefined {
  if (!trigger || typeof trigger !== "object" || !("value" in trigger)) return undefined;
  const value = trigger.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function triggerDelivery(trigger: unknown): string | undefined {
  if (!trigger || typeof trigger !== "object" || !("delivery" in trigger)) return undefined;
  return typeof trigger.delivery === "string" ? trigger.delivery : undefined;
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
