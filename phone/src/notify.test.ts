import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { applyMigrations } from "./db/migrate";
import { named, nodeRun, openMemory } from "./db/node-run";
import {
  REMINDER_CAP,
  loadDueReminders,
  markFiredOn,
  notificationCopy,
  notificationIdentifier,
  planReminders,
  reminderId,
  replaceScheduled,
  type DueReminder,
  type NotificationPort,
  type PlannedReminder,
} from "./notify";

const now = "2026-10-08T12:00:00.000Z";
const stamp = "2026-10-08T12:00:00.000Z";

function due(hoursAhead: number): { dueOn: string; dueTime: string } {
  const at = new Date(Date.parse(now) + hoursAhead * 60 * 60 * 1000);
  return { dueOn: at.toISOString().slice(0, 10), dueTime: at.toISOString().slice(11, 16) };
}

function row(id: string, hoursAhead: number, extra: Partial<DueReminder> = {}): DueReminder {
  const when = due(hoursAhead);
  return {
    id,
    taskTitle: `Task ${id}`,
    lineText: null,
    dueOn: when.dueOn,
    dueTime: when.dueTime,
    minutesBefore: 0,
    ...extra,
  };
}

it("schedules the 64 soonest inside seven days and does not treat the cap as a failure", () => {
  const rows = Array.from({ length: 70 }, (_, index) => row(`r${String(index).padStart(2, "0")}`, index + 1));
  rows.push(row("next-year", 24 * 400));
  rows.push({ ...row("bad", 1), dueOn: "not-a-date" });
  rows.push(row("past", -1));
  const plan = planReminders(rows, now, "UTC");
  expect(REMINDER_CAP).toBe(64);
  expect(plan.scheduled).toHaveLength(64);
  expect(plan.scheduled.map((item) => item.id)).toEqual(Array.from({ length: 64 }, (_, index) => `r${String(index).padStart(2, "0")}`));
  expect(plan.scheduled.some((item) => item.id === "next-year" || item.id === "bad" || item.id === "past")).toBe(false);
  expect(plan.fired).toEqual(["past"]);
});

it("uses 09:00 local when the due time is missing and keeps an instant on the seven-day edge", () => {
  const plan = planReminders(
    [
      { id: "nine", taskTitle: "Gym", lineText: null, dueOn: "2026-10-09", dueTime: null, minutesBefore: 0 },
      row("edge", 7 * 24),
      row("after", 7 * 24 + 1),
      { id: "shoes", taskTitle: "Gym", lineText: "shoes", dueOn: "2026-10-09", dueTime: "18:00", minutesBefore: 0 },
    ],
    now,
    "UTC",
  );
  const nine = plan.scheduled.find((item) => item.id === "nine");
  expect(nine?.fireAt.startsWith("2026-10-09T09:00")).toBe(true);
  expect(plan.scheduled.map((item) => item.id)).toContain("edge");
  expect(plan.scheduled.map((item) => item.id)).not.toContain("after");
  expect(plan.fired).toEqual([]);
  expect(notificationCopy(plan.scheduled.find((item) => item.id === "shoes")!).body).toBe("Gym");
  expect(notificationCopy(plan.scheduled.find((item) => item.id === "shoes")!).title).toBe("shoes");
  expect(notificationCopy(plan.scheduled.find((item) => item.id === "nine")!).title).toBe("Layp");
});

it("orders equal instants by id", () => {
  const plan = planReminders([row("b", 2), row("a", 2)], now, "UTC");
  expect(plan.scheduled.map((item) => item.id)).toEqual(["a", "b"]);
});

it("cancels layp notifications and schedules the task title after permission is granted", async () => {
  const log: string[] = [];
  const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const items: PlannedReminder[] = [
    { id: "gym", taskTitle: "Gym", lineText: null, fireAt: soon },
    { id: "shoes", taskTitle: "Gym", lineText: "shoes", fireAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
  ];
  const port: NotificationPort = {
    allow: async () => {
      log.push("allow");
      return true;
    },
    pending: async () => [{ identifier: "layp:old" }, { identifier: "system" }],
    cancel: async (identifier) => {
      log.push(`cancel:${identifier}`);
    },
    schedule: async (notice) => {
      log.push(`schedule:${notice.identifier}:${notice.title}:${notice.body}`);
    },
  };
  expect(await replaceScheduled(port, items)).toBe("ok");
  expect(log).toEqual([
    "allow",
    "cancel:layp:old",
    `schedule:${notificationIdentifier("gym")}:Layp:Gym`,
    `schedule:${notificationIdentifier("shoes")}:shoes:Gym`,
  ]);
});

it("a permission denial schedules nothing and is separate from the 64 cap", async () => {
  const log: string[] = [];
  const items = Array.from({ length: 64 }, (_, index) => ({
    id: `r${index}`,
    taskTitle: `Task ${index}`,
    lineText: null,
    fireAt: new Date(Date.now() + (index + 1) * 60 * 1000).toISOString(),
  }));
  const denied: NotificationPort = {
    allow: async () => false,
    pending: async () => {
      log.push("pending");
      return [{ identifier: "layp:keep" }];
    },
    cancel: async () => {
      log.push("cancel");
    },
    schedule: async () => {
      log.push("schedule");
    },
  };
  expect(await replaceScheduled(denied, items)).toBe("denied");
  expect(log).toEqual([]);

  const empty: NotificationPort = {
    allow: async () => {
      log.push("allow");
      return false;
    },
    pending: async () => [{ identifier: "layp:stale" }, { identifier: "system" }],
    cancel: async (identifier) => {
      log.push(`cancel:${identifier}`);
    },
    schedule: async () => {
      log.push("schedule");
    },
  };
  expect(await replaceScheduled(empty, [])).toBe("ok");
  expect(log).toEqual(["cancel:layp:stale"]);
});

it("keeps going when one schedule rejects", async () => {
  const scheduled: string[] = [];
  const port: NotificationPort = {
    allow: async () => true,
    pending: async () => [],
    cancel: async () => undefined,
    schedule: async (notice) => {
      if (notice.identifier.endsWith("bad")) throw new Error("rejected");
      scheduled.push(notice.body);
    },
  };
  const items: PlannedReminder[] = [
    { id: "bad", taskTitle: "Hidden", lineText: null, fireAt: new Date(Date.now() + 60_000).toISOString() },
    { id: "ok", taskTitle: "Visible", lineText: null, fireAt: new Date(Date.now() + 120_000).toISOString() },
  ];
  expect(await replaceScheduled(port, items)).toBe("ok");
  expect(scheduled).toEqual(["Visible"]);
});

it("reads the reminder id back from its notification identifier", () => {
  expect(reminderId(notificationIdentifier("rem-1"))).toBe("rem-1");
  expect(reminderId("layp:")).toBeNull();
  expect(reminderId("system")).toBeNull();
});

it("does not request an Expo push token", () => {
  const source = readFileSync(fileURLToPath(new URL("./notify.ts", import.meta.url)), "utf8");
  expect(source.includes("getExpoPushTokenAsync")).toBe(false);
  expect(source.includes("getDevicePushTokenAsync")).toBe(false);
});

it("loads unfired reminders and checklist lines for open tasks only", async () => {
  const db = await prepare();
  const rows = await loadDueReminders(nodeRun(db));
  expect(rows.map((item) => item.id).sort()).toEqual(["check-open", "rem-nine", "rem-open"]);
  const nine = rows.find((item) => item.id === "rem-nine");
  expect(nine?.dueTime).toBeNull();
  expect(nine?.taskTitle).toBe("Task nine");
  const check = rows.find((item) => item.id === "check-open");
  expect(check?.lineText).toBe("shoes");
  expect(check?.taskTitle).toBe("Task open");
});

it("stamps fired_at once and leaves an already fired row alone", async () => {
  const db = await prepare();
  const run = nodeRun(db);
  expect(await markFiredOn(run, ["rem-open", "check-open", "missing"], "2026-10-08T15:00:00.000Z")).toBe(true);
  const reminder = db.prepare("SELECT fired_at, updated_at FROM reminders WHERE id = 'rem-open'").get() as {
    fired_at: string;
    updated_at: string;
  };
  expect(reminder).toEqual({ fired_at: "2026-10-08T15:00:00.000Z", updated_at: "2026-10-08T15:00:00.000Z" });
  const check = db.prepare("SELECT fired_at, updated_at FROM checklist_reminders WHERE id = 'check-open'").get() as {
    fired_at: string;
    updated_at: string;
  };
  expect(check.fired_at).toBe("2026-10-08T15:00:00.000Z");
  const already = db.prepare("SELECT fired_at, updated_at FROM reminders WHERE id = 'rem-fired'").get() as {
    fired_at: string;
    updated_at: string;
  };
  expect(already).toEqual({ fired_at: "2026-10-07T00:00:00.000Z", updated_at: "2026-10-07T00:00:00.000Z" });
  expect(await markFiredOn(run, ["rem-open"], "2026-10-08T16:00:00.000Z")).toBe(false);
  const again = db.prepare("SELECT fired_at FROM reminders WHERE id = 'rem-open'").get() as { fired_at: string };
  expect(again.fired_at).toBe("2026-10-08T15:00:00.000Z");
});

async function prepare(): Promise<DatabaseSync> {
  const db = openMemory();
  const files = ["001_schema.sql", "002_checklist_reminders.sql", "003_attachments.sql", "004_fts.sql", "005_phone.sql"].map(
    (name, index) => ({
      version: index + 1,
      sql: readFileSync(fileURLToPath(new URL(`../../app/src-tauri/migrations/${name}`, import.meta.url)), "utf8"),
    }),
  );
  await applyMigrations(
    {
      exec: async (sql) => {
        db.exec(sql);
      },
      all: async (sql, values) => {
        const statement = db.prepare(sql);
        return (values?.length ? statement.all(named(values)) : statement.all()) as Record<string, unknown>[];
      },
      run: async (sql, values) => {
        const statement = db.prepare(sql);
        if (values?.length) statement.run(named(values));
        else statement.run();
      },
      transaction: async (body) => {
        db.exec("BEGIN");
        try {
          await body();
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      },
    },
    files,
  );
  db.prepare(
    `INSERT INTO lists (id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at)
     VALUES ('work', NULL, 'Work', '#ffdc58', 1, NULL, 0, $created, $created)`,
  ).run({ $created: stamp });
  insertTask(db, "open", "2026-10-09", "18:00", null, null);
  insertTask(db, "nine", "2026-10-09", null, null, null);
  insertTask(db, "done", "2026-10-09", "18:00", stamp, null);
  insertTask(db, "trashed", "2026-10-09", "18:00", null, stamp);
  insertTask(db, "undated", null, null, null, null);
  insertReminder(db, "rem-open", "open", null);
  insertReminder(db, "rem-nine", "nine", null);
  insertReminder(db, "rem-done", "done", null);
  insertReminder(db, "rem-trashed", "trashed", null);
  insertReminder(db, "rem-undated", "undated", null);
  insertReminder(db, "rem-fired", "open", "2026-10-07T00:00:00.000Z");
  insertChecklist(db, "check-open", "open", null);
  insertChecklist(db, "check-done", "done", null);
  return db;
}

function insertTask(
  db: DatabaseSync,
  id: string,
  dueOn: string | null,
  dueTime: string | null,
  completedAt: string | null,
  deletedAt: string | null,
): void {
  db.prepare(
    `INSERT INTO tasks (
      id, series_id, list_id, section_id, parent_id, title, notes, priority,
      important, urgent, pinned, start_on, due_on, due_time, duration_minutes, recurrence_json,
      estimated_pomos, completed_pomos, sort_order, completed_at, deleted_at, created_at, updated_at
    ) VALUES (
      $id, $id, 'work', NULL, NULL, $title, '', 'none',
      0, 0, 0, NULL, $due, $time, NULL, NULL,
      NULL, 0, 0, $completed, $deleted, $created, $created
    )`,
  ).run({
    $id: id,
    $title: `Task ${id}`,
    $due: dueOn,
    $time: dueTime,
    $completed: completedAt,
    $deleted: deletedAt,
    $created: stamp,
  });
}

function insertReminder(db: DatabaseSync, id: string, taskId: string, firedAt: string | null): void {
  db.prepare(
    `INSERT INTO reminders (id, task_id, minutes_before, fired_at, created_at, updated_at)
     VALUES ($id, $task, 15, $fired, $created, $updated)`,
  ).run({
    $id: id,
    $task: taskId,
    $fired: firedAt,
    $created: stamp,
    $updated: firedAt ?? stamp,
  });
}

function insertChecklist(db: DatabaseSync, id: string, taskId: string, firedAt: string | null): void {
  db.prepare(
    `INSERT INTO checklist_reminders (
      id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at, updated_at
    ) VALUES ($id, $task, 'shoes', '2026-10-09', NULL, 5, $fired, $created, $updated)`,
  ).run({
    $id: id,
    $task: taskId,
    $fired: firedAt,
    $created: stamp,
    $updated: firedAt ?? stamp,
  });
}
