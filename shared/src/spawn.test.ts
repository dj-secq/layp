import { expect, it } from "vitest";
import { parseRule, rule, serializeRule } from "./recur";
import { nextOccurrenceDraft, type OccurrenceSource } from "./spawn";

function source(remaining: number): OccurrenceSource {
  return {
    seriesId: "series-1",
    listId: "list-1",
    sectionId: "section-1",
    parentId: null,
    title: "Gym",
    notes: "bring shoes",
    priority: "high",
    important: true,
    urgent: false,
    pinned: true,
    startOn: "2026-10-06",
    dueOn: "2026-10-08",
    dueTime: "18:00",
    durationMinutes: 30,
    estimatedPomos: 4,
    recurrenceJson: serializeRule(rule({ freq: "daily", end: { type: "count", remaining } })),
    tagIds: ["tag-a", "tag-b"],
    reminderOffsets: [15, 60],
    checklistReminders: [{ lineText: "shoes", dueOn: "2026-10-08", dueTime: null, minutesBefore: 5 }],
  };
}

it("copies the series, tags, reminders, and checklist reminders, and decrements the count", () => {
  const draft = nextOccurrenceDraft(source(3), "2026-10-08");
  expect(draft).toMatchObject({
    seriesId: "series-1",
    listId: "list-1",
    sectionId: "section-1",
    title: "Gym",
    notes: "bring shoes",
    priority: "high",
    important: true,
    urgent: false,
    pinned: true,
    startOn: "2026-10-07",
    dueOn: "2026-10-09",
    dueTime: "18:00",
    durationMinutes: 30,
    estimatedPomos: 4,
    tagIds: ["tag-a", "tag-b"],
    reminderOffsets: [15, 60],
    checklistReminders: [{ lineText: "shoes", dueOn: "2026-10-08", dueTime: null, minutesBefore: 5, firedAt: null }],
  });
  expect(parseRule(draft?.recurrenceJson ?? "")?.end).toEqual({ type: "count", remaining: 2 });
});

it("returns null when the remaining count is 1", () => {
  expect(nextOccurrenceDraft(source(1), "2026-10-08")).toBeNull();
});
