import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useEffect, useRef } from "react";
import { Temporal } from "temporal-polyfill";
import { logFailure } from "../db/client";
import { loadUnfiredChecklistReminders, loadUnfiredReminders, markFired } from "../db/reminders";
import { showReminder } from "../desktop/notify";
import { missedSummary, scheduleReminders, splitByHorizon, type ScheduledReminder } from "../lib/remind";
import { useApp } from "../state/AppState";

const POLL_MS = 60_000;
const MAX_DELAY = 2_147_000_000;

export function ReminderClock() {
  const app = useApp();
  const revision = app.revision;
  const openTask = useRef(app.setOpenTaskId);
  const setPermission = useRef(app.setNotificationPermission);
  const bump = useRef(app.bump);
  const booted = useRef(false);
  const asked = useRef(false);
  const chain = useRef(Promise.resolve());
  const timers = useRef<number[]>([]);
  openTask.current = app.setOpenTaskId;
  setPermission.current = app.setNotificationPermission;
  bump.current = app.bump;

  useEffect(() => {
    let stop = () => {};
    let closed = false;
    void listen<{ taskId?: string | null }>("reminder-open", (event) => {
      const id = event.payload?.taskId;
      if (id) openTask.current(id);
    })
      .then((unlisten) => {
        if (closed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        void logFailure("reminder failed");
      });
    return () => {
      closed = true;
      stop();
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    const run = () => {
      chain.current = chain.current
        .then(async () => {
          if (!cancel) await sync();
        })
        .catch(() => {
          void logFailure("reminder failed");
        });
    };
    run();
    const poll = window.setInterval(run, POLL_MS);
    return () => {
      cancel = true;
      window.clearInterval(poll);
      clearTimers(timers.current);
      timers.current = [];
    };

    async function sync() {
      clearTimers(timers.current);
      timers.current = [];
      const [taskRows, checklistRows] = await Promise.all([loadUnfiredReminders(), loadUnfiredChecklistReminders()]);
      const rows = [...taskRows, ...checklistRows];
      if (cancel) return;
      if (rows.length === 0) {
        booted.current = true;
        return;
      }
      const granted = await ensurePermission();
      if (cancel || !granted) return;
      const now = Temporal.Now.instant().toString();
      const scheduled = scheduleReminders(rows, Temporal.Now.timeZoneId());
      const split = splitByHorizon(scheduled, now);
      let changed = false;
      if (!booted.current) {
        if (split.due.length > 0) {
          const body = missedSummary(split.due.map((item) => item.title));
          if (!body) return;
          const taskId = split.due.length === 1 ? split.due[0].taskId : null;
          const ok = await deliver({ title: "Layp", body, taskId });
          if (!ok || cancel) return;
          await markFired(split.due.map((item) => item.id));
          changed = true;
        }
        booted.current = true;
      } else {
        for (const item of split.due) {
          if (cancel) return;
          const ok = await deliver({ title: item.title, body: item.listName, taskId: item.taskId });
          if (!ok) break;
          await markFired([item.id]);
          changed = true;
        }
      }
      if (changed) bump.current();
      if (cancel) return;
      clearTimers(timers.current);
      const started = Temporal.Now.instant();
      timers.current = split.soon.map((item) => {
        const at = Temporal.Instant.from(item.fireAt);
        const delay = Math.min(MAX_DELAY, Math.max(0, at.epochMilliseconds - started.epochMilliseconds));
        return window.setTimeout(() => {
          chain.current = chain.current.then(() => fireOne(item)).catch(() => {
            void logFailure("reminder failed");
          });
        }, delay);
      });
    }

    async function fireOne(item: ScheduledReminder) {
      if (cancel) return;
      const [taskRows, checklistRows] = await Promise.all([loadUnfiredReminders(), loadUnfiredChecklistReminders()]);
      const rows = [...taskRows, ...checklistRows];
      if (cancel || !rows.some((row) => row.id === item.id)) return;
      const granted = await ensurePermission();
      if (!granted) return;
      const ok = await deliver({ title: item.title, body: item.listName, taskId: item.taskId });
      if (!ok) return;
      await markFired([item.id]);
      bump.current();
    }
  }, [revision]);

  async function ensurePermission(): Promise<boolean> {
    try {
      let granted = await isPermissionGranted();
      if (!granted && !asked.current) {
        asked.current = true;
        granted = (await requestPermission()) === "granted";
      }
      setPermission.current(granted ? "granted" : "denied");
      return granted;
    } catch {
      setPermission.current("denied");
      await logFailure("reminder failed");
      return false;
    }
  }

  return null;
}

async function deliver(input: { title: string; body: string; taskId: string | null }): Promise<boolean> {
  try {
    await showReminder(input);
    return true;
  } catch {
    await logFailure("reminder failed");
    return false;
  }
}

function clearTimers(handles: number[]) {
  for (const handle of handles) window.clearTimeout(handle);
}
