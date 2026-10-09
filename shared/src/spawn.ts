import { Temporal } from "temporal-polyfill";
import { checklistReminderCopies, type ChecklistReminderCopy } from "./checklistReminders";
import { addDays } from "./dates";
import { anchorDate, nextDueDate, parseRule, ruleAfterComplete, serializeRule } from "./recur";
import type { Priority } from "./rows";

export type OccurrenceReminder = {
  lineText: string;
  dueOn: string;
  dueTime: string | null;
  minutesBefore: number;
};

export type OccurrenceSource = {
  seriesId: string;
  listId: string;
  sectionId: string | null;
  parentId: string | null;
  title: string;
  notes: string;
  priority: Priority;
  important: boolean;
  urgent: boolean;
  pinned: boolean;
  startOn: string | null;
  dueOn: string | null;
  dueTime: string | null;
  durationMinutes: number | null;
  estimatedPomos: number | null;
  recurrenceJson: string | null;
  tagIds: string[];
  reminderOffsets: number[];
  checklistReminders: OccurrenceReminder[];
};

export type OccurrenceDraft = {
  seriesId: string;
  listId: string;
  sectionId: string | null;
  parentId: string | null;
  title: string;
  notes: string;
  priority: Priority;
  important: boolean;
  urgent: boolean;
  pinned: boolean;
  startOn: string | null;
  dueOn: string;
  dueTime: string | null;
  durationMinutes: number | null;
  estimatedPomos: number | null;
  recurrenceJson: string;
  tagIds: string[];
  reminderOffsets: number[];
  checklistReminders: ChecklistReminderCopy[];
};

function shiftStart(startOn: string, dueOn: string, nextDue: string): string {
  const start = Temporal.PlainDate.from(startOn);
  const due = Temporal.PlainDate.from(dueOn);
  const next = Temporal.PlainDate.from(nextDue);
  const days = start.until(due, { largestUnit: "days" }).days;
  return addDays(next.toString(), -days);
}

/** Next open task, or null when the rule cannot produce a date. The insert assigns the id and stamps. */
export function nextOccurrenceDraft(source: OccurrenceSource, completedOn: string): OccurrenceDraft | null {
  const parsed = source.recurrenceJson ? parseRule(source.recurrenceJson) : null;
  if (!parsed) return null;
  const anchor = anchorDate(parsed, source.dueOn, completedOn);
  if (!anchor) return null;
  const dueOn = nextDueDate(parsed, anchor);
  const nextRule = dueOn ? ruleAfterComplete(parsed) : null;
  if (!dueOn || !nextRule) return null;
  const startOn = source.startOn && source.dueOn ? shiftStart(source.startOn, source.dueOn, dueOn) : null;
  return {
    seriesId: source.seriesId,
    listId: source.listId,
    sectionId: source.sectionId,
    parentId: source.parentId,
    title: source.title,
    notes: source.notes,
    priority: source.priority,
    important: source.important,
    urgent: source.urgent,
    pinned: source.pinned,
    startOn,
    dueOn,
    dueTime: source.dueTime,
    durationMinutes: source.durationMinutes,
    estimatedPomos: source.estimatedPomos,
    recurrenceJson: serializeRule(nextRule),
    tagIds: [...source.tagIds],
    reminderOffsets: [...source.reminderOffsets],
    checklistReminders: checklistReminderCopies(source.checklistReminders),
  };
}
