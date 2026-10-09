import { z } from "zod";
import {
  checklistReminderBlock,
  checklistReminderCopies,
  reconcileChecklistReminders,
  type ChecklistReminderLink,
} from "@layp/shared";
import { logFailure, query, withStamp, writeStamped, type SqlStatement } from "./client";
import { deletionStatement } from "./deletions";
import type { SaveResult } from "./types";

const count = z.union([z.number(), z.string()]).transform((value) => Number(value));

const storedRow = z.object({
  id: z.string(),
  line_text: z.string(),
  due_on: z.string(),
  due_time: z.string().nullish().transform((value) => value ?? null),
  minutes_before: count,
});

export type ChecklistReminder = {
  id: string;
  lineText: string;
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
};

export async function checklistRemindersForTask(taskId: string): Promise<ChecklistReminder[]> {
  const rows = await query<unknown>(
    `SELECT id, line_text, due_on, due_time, minutes_before
     FROM checklist_reminders WHERE task_id = $1
     ORDER BY due_on ASC, due_time ASC, created_at ASC`,
    [taskId],
  );
  return rows.map((row) => {
    const parsed = storedRow.parse(row);
    return {
      id: parsed.id,
      lineText: parsed.line_text,
      dueOn: parsed.due_on,
      dueTime: parsed.due_time,
      minutesBefore: parsed.minutes_before,
    };
  });
}

export async function syncChecklistReminders(taskId: string, previousNotes: string, nextNotes: string): Promise<void> {
  const current = await checklistRemindersForTask(taskId);
  const plan = reconcileChecklistReminders(previousNotes, nextNotes, current);
  if (plan.updates.length === 0 && plan.removeIds.length === 0) return;
  await withStamp(async (stamp, run) => {
    const statements: SqlStatement[] = [];
    for (const update of plan.updates) {
      statements.push({
        sql: `UPDATE checklist_reminders SET line_text = $1, updated_at = $2 WHERE id = $3`,
        values: [update.lineText, stamp, update.id],
      });
    }
    for (const id of plan.removeIds) {
      statements.push(deletionStatement("checklist_reminders", id, stamp));
      statements.push({ sql: `DELETE FROM checklist_reminders WHERE id = $1`, values: [id] });
    }
    await run(statements);
  });
}

export async function addChecklistReminder(input: {
  taskId: string;
  notes: string;
  lineText: string;
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
}): Promise<SaveResult<ChecklistReminder>> {
  const existing = await checklistRemindersForTask(input.taskId);
  const current = existing.find((row) => row.lineText === input.lineText.trim());
  const links: ChecklistReminderLink[] = existing
    .filter((row) => row.id !== current?.id)
    .map((row) => ({ id: row.id, lineText: row.lineText }));
  const block = checklistReminderBlock(input.notes, input.lineText, links, Boolean(current));
  if (block) return { status: "error", message: block };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return { status: "error", message: "Add a due date." };
  if (!Number.isInteger(input.minutesBefore) || input.minutesBefore < 0 || input.minutesBefore > 10080) {
    return { status: "error", message: "Use 0 to 10080 minutes." };
  }
  try {
    const row: ChecklistReminder = {
      id: current?.id ?? crypto.randomUUID(),
      lineText: input.lineText.trim(),
      dueOn: input.dueOn,
      dueTime: input.dueTime,
      minutesBefore: input.minutesBefore,
    };
    if (current) {
      await writeStamped((stamp) => [
        {
          sql: `UPDATE checklist_reminders
                SET due_on = $1, due_time = $2, minutes_before = $3, fired_at = NULL, updated_at = $4
                WHERE id = $5`,
          values: [row.dueOn, row.dueTime, row.minutesBefore, stamp, row.id],
        },
      ]);
    } else {
      await writeStamped((stamp) => [
        {
          sql: `INSERT INTO checklist_reminders (
                  id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $7)`,
          values: [row.id, input.taskId, row.lineText, row.dueOn, row.dueTime, row.minutesBefore, stamp],
        },
      ]);
    }
    return { status: "saved", row };
  } catch {
    await logFailure("reminder failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function removeChecklistReminder(id: string): Promise<SaveResult<{ id: string }>> {
  const rows = await query<{ id: string }>(`SELECT id FROM checklist_reminders WHERE id = $1`, [id]);
  if (rows.length === 0) return { status: "error", message: "Not saved" };
  try {
    await withStamp(async (stamp, run) => {
      await run([
        deletionStatement("checklist_reminders", id, stamp),
        { sql: `DELETE FROM checklist_reminders WHERE id = $1`, values: [id] },
      ]);
    });
    return { status: "saved", row: { id } };
  } catch {
    await logFailure("reminder failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function copyChecklistReminders(fromTaskId: string, toTaskId: string): Promise<void> {
  const rows = await query<{ line_text: string; due_on: string; due_time: string | null; minutes_before: number | string }>(
    `SELECT line_text, due_on, due_time, minutes_before FROM checklist_reminders WHERE task_id = $1`,
    [fromTaskId],
  );
  const copies = checklistReminderCopies(
    rows.map((row) => ({
      lineText: row.line_text,
      dueOn: row.due_on,
      dueTime: row.due_time,
      minutesBefore: Number(row.minutes_before),
    })),
  );
  if (copies.length === 0) return;
  await writeStamped((stamp) =>
    copies.map((row) => ({
      sql: `INSERT INTO checklist_reminders (
              id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      values: [crypto.randomUUID(), toTaskId, row.lineText, row.dueOn, row.dueTime, row.minutesBefore, row.firedAt, stamp],
    })),
  );
}
