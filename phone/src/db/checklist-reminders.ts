import { checklistReminderBlock, type ChecklistReminderLink } from "@layp/shared";
import { randomUUID } from "../link/random";
import { withStamp } from "./lock";
import type { Run } from "./sql";

export type ChecklistReminder = {
  id: string;
  lineText: string;
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
};

export type ChecklistSave<T> = { status: "saved"; row: T } | { status: "error"; message: string };

async function forTask(run: Run, taskId: string): Promise<ChecklistReminder[]> {
  const loaded = await run([
    {
      sql: `SELECT id, line_text, due_on, due_time, minutes_before FROM checklist_reminders WHERE task_id = $1 ORDER BY created_at ASC`,
      values: [taskId],
    },
  ]);
  return (loaded.batches[0]?.rows ?? []).flatMap((row) =>
    typeof row.id === "string" && typeof row.line_text === "string" && typeof row.due_on === "string"
      ? [{
          id: row.id,
          lineText: row.line_text,
          dueOn: row.due_on,
          dueTime: typeof row.due_time === "string" ? row.due_time : null,
          minutesBefore: Number(row.minutes_before),
        }]
      : [],
  );
}

export async function addChecklistReminder(input: {
  taskId: string;
  notes: string;
  lineText: string;
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
}): Promise<ChecklistSave<ChecklistReminder>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return { status: "error", message: "Add a due date." };
  if (!Number.isInteger(input.minutesBefore) || input.minutesBefore < 0 || input.minutesBefore > 10080) {
    return { status: "error", message: "Use 0 to 10080 minutes." };
  }
  try {
    return await withStamp(async (stamp, run) => {
      const existing = await forTask(run, input.taskId);
      const current = existing.find((row) => row.lineText === input.lineText.trim());
      const links: ChecklistReminderLink[] = existing
        .filter((row) => row.id !== current?.id)
        .map((row) => ({ id: row.id, lineText: row.lineText }));
      const block = checklistReminderBlock(input.notes, input.lineText, links, Boolean(current));
      if (block) return { status: "error", message: block };
      const row: ChecklistReminder = {
        id: current?.id ?? randomUUID(),
        lineText: input.lineText.trim(),
        dueOn: input.dueOn,
        dueTime: input.dueTime,
        minutesBefore: input.minutesBefore,
      };
      if (current) {
        await run([
          {
            sql: `UPDATE checklist_reminders
                  SET due_on = $1, due_time = $2, minutes_before = $3, fired_at = NULL, updated_at = $4
                  WHERE id = $5`,
            values: [row.dueOn, row.dueTime, row.minutesBefore, stamp, row.id],
          },
        ]);
      } else {
        await run([
          {
            sql: `INSERT INTO checklist_reminders (
                    id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at, updated_at
                  ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $7)`,
            values: [row.id, input.taskId, row.lineText, row.dueOn, row.dueTime, row.minutesBefore, stamp],
          },
        ]);
      }
      return { status: "saved", row };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function removeChecklistReminder(id: string): Promise<ChecklistSave<{ id: string }>> {
  try {
    const removed = await withStamp(async (stamp, run) => {
      const found = await run([{ sql: `SELECT id FROM checklist_reminders WHERE id = $1`, values: [id] }]);
      if ((found.batches[0]?.rows.length ?? 0) === 0) return false;
      await run([
        {
          sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), "checklist_reminders", id, stamp],
        },
        { sql: `DELETE FROM checklist_reminders WHERE id = $1`, values: [id] },
      ]);
      return true;
    });
    if (!removed) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}
