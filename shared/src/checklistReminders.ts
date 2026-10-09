import { checklistLines } from "./checklist";

export type ChecklistReminderLink = {
  id: string;
  lineText: string;
};

export type ChecklistReminderPlan = {
  updates: { id: string; lineText: string }[];
  removeIds: string[];
};

export function reconcileChecklistReminders(
  previousNotes: string,
  nextNotes: string,
  reminders: ChecklistReminderLink[],
): ChecklistReminderPlan {
  const previous = checklistLines(previousNotes).map((line) => line.text);
  const next = checklistLines(nextNotes).map((line) => line.text);
  const nextCounts = counts(next);
  const updates: { id: string; lineText: string }[] = [];
  const claimed = new Set<string>();

  if (previous.length === next.length) {
    const changed: number[] = [];
    for (let index = 0; index < previous.length; index += 1) {
      if (previous[index] !== next[index]) changed.push(index);
    }
    if (changed.length === 1) {
      const from = previous[changed[0]];
      const to = next[changed[0]];
      const hits = reminders.filter((reminder) => reminder.lineText === from);
      const taken = reminders.some((reminder) => reminder.lineText === to);
      if (hits.length === 1 && !taken && (nextCounts.get(from) ?? 0) === 0) {
        updates.push({ id: hits[0].id, lineText: to });
        claimed.add(hits[0].id);
        const left = (nextCounts.get(to) ?? 0) - 1;
        if (left > 0) nextCounts.set(to, left);
        else nextCounts.delete(to);
      }
    }
  }

  const removeIds: string[] = [];
  for (const reminder of reminders) {
    if (claimed.has(reminder.id)) continue;
    const left = nextCounts.get(reminder.lineText) ?? 0;
    if (left > 0) nextCounts.set(reminder.lineText, left - 1);
    else removeIds.push(reminder.id);
  }
  return { updates, removeIds };
}

export function checklistReminderBlock(
  notes: string,
  lineText: string,
  reminders: ChecklistReminderLink[],
  updating = false,
): string | null {
  const text = lineText.trim();
  if (!text) return "Add text to the checklist line first.";
  const matches = checklistLines(notes).filter((line) => line.text === text).length;
  if (matches !== 1) return "These lines need different text.";
  if (reminders.some((reminder) => reminder.lineText === text)) return "That reminder is already set.";
  if (!updating && reminders.length >= 10) return "A checklist can have 10 reminders.";
  return null;
}

export type ChecklistReminderCopy = {
  lineText: string;
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
  firedAt: null;
};

/** Next occurrence keeps the stored due and clears fired_at. Ids are assigned by the insert. */
export function checklistReminderCopies(
  rows: { lineText: string; dueOn: string; dueTime: string | null; minutesBefore: number }[],
): ChecklistReminderCopy[] {
  return rows.map((row) => ({
    lineText: row.lineText,
    dueOn: row.dueOn,
    dueTime: row.dueTime,
    minutesBefore: row.minutesBefore,
    firedAt: null,
  }));
}

function counts(lines: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) map.set(line, (map.get(line) ?? 0) + 1);
  return map;
}
