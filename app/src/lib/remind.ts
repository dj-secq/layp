import { Temporal } from "temporal-polyfill";

/** UTC instant for a reminder. A missing due time means 09:00 local. A skipped DST hour fires at the next valid minute. */
export function reminderInstant(input: {
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
  timeZone: string;
}): string {
  const date = Temporal.PlainDate.from(input.dueOn);
  const [hour, minute] = (input.dueTime ?? "09:00").split(":").map(Number);
  const due = validLocal(date.toPlainDateTime({ hour, minute }), input.timeZone);
  const minutesBefore = Math.min(10080, Math.max(0, Math.trunc(input.minutesBefore)));
  return due.subtract({ minutes: minutesBefore }).toInstant().toString();
}

export function missedSummary(titles: string[]): string | null {
  if (titles.length === 0) return null;
  if (titles.length > 3) return `${titles.length} reminders passed while Layp was quit`;
  if (titles.length === 1) return `${titles[0]} passed while Layp was quit`;
  const named = titles.length === 2 ? `${titles[0]} and ${titles[1]}` : `${titles[0]}, ${titles[1]}, and ${titles[2]}`;
  return `${named} passed while Layp was quit`;
}

export function reminderLabel(minutesBefore: number): string {
  if (minutesBefore <= 0) return "At due time";
  if (minutesBefore === 60) return "1 hour before";
  if (minutesBefore === 1440) return "1 day before";
  if (minutesBefore % 1440 === 0) return `${minutesBefore / 1440} days before`;
  if (minutesBefore % 60 === 0) return `${minutesBefore / 60} hours before`;
  if (minutesBefore === 1) return "1 minute before";
  return `${minutesBefore} minutes before`;
}

export type ScheduledReminder = {
  id: string;
  taskId: string;
  title: string;
  listName: string;
  minutesBefore: number;
  fireAt: string;
};

export function scheduleReminders(
  rows: Array<{
    id: string;
    taskId: string;
    title: string;
    listName: string;
    dueOn: string;
    dueTime: string | null;
    minutesBefore: number;
  }>,
  timeZone: string,
): ScheduledReminder[] {
  const scheduled: ScheduledReminder[] = [];
  for (const row of rows) {
    try {
      scheduled.push({
        id: row.id,
        taskId: row.taskId,
        title: row.title,
        listName: row.listName,
        minutesBefore: row.minutesBefore,
        fireAt: reminderInstant({
          dueOn: row.dueOn,
          dueTime: row.dueTime,
          minutesBefore: row.minutesBefore,
          timeZone,
        }),
      });
    } catch {
      // A bad civil date cannot be scheduled. The row stays unfired.
    }
  }
  return scheduled;
}

/** Due reminders are at or before `nowIso`. Soon reminders fall inside the next `horizonHours`. */
export function splitByHorizon(items: ScheduledReminder[], nowIso: string, horizonHours = 48): {
  due: ScheduledReminder[];
  soon: ScheduledReminder[];
} {
  const now = Temporal.Instant.from(nowIso);
  const horizon = now.add({ hours: horizonHours });
  const due: ScheduledReminder[] = [];
  const soon: ScheduledReminder[] = [];
  for (const item of items) {
    const at = Temporal.Instant.from(item.fireAt);
    if (Temporal.Instant.compare(at, now) <= 0) due.push(item);
    else if (Temporal.Instant.compare(at, horizon) <= 0) soon.push(item);
  }
  return { due, soon };
}

function validLocal(local: Temporal.PlainDateTime, timeZone: string): Temporal.ZonedDateTime {
  let cursor = local;
  for (let step = 0; step < 180; step += 1) {
    try {
      return cursor.toZonedDateTime(timeZone, { disambiguation: "reject" });
    } catch {
      cursor = cursor.add({ minutes: 1 });
    }
  }
  return local.toZonedDateTime(timeZone, { disambiguation: "compatible" });
}
