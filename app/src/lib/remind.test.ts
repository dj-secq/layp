import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { missedSummary, reminderInstant, reminderLabel, scheduleReminders, splitByHorizon } from "./remind";

describe("reminderInstant", () => {
  it("uses 09:00 when the task has a date and no time", () => {
    const instant = reminderInstant({
      dueOn: "2026-01-15",
      dueTime: null,
      minutesBefore: 0,
      timeZone: "America/New_York",
    });
    const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO("America/New_York");
    expect(zoned.hour).toBe(9);
    expect(zoned.minute).toBe(0);
    expect(zoned.toPlainDate().toString()).toBe("2026-01-15");
  });

  it("fires the given number of minutes before the due time", () => {
    const instant = reminderInstant({
      dueOn: "2026-06-02",
      dueTime: "18:00",
      minutesBefore: 60,
      timeZone: "UTC",
    });
    expect(instant.startsWith("2026-06-02T17:00")).toBe(true);
  });

  it("moves a skipped spring-forward hour to the next valid minute", () => {
    const instant = reminderInstant({
      dueOn: "2026-03-08",
      dueTime: "02:30",
      minutesBefore: 0,
      timeZone: "America/New_York",
    });
    const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO("America/New_York");
    expect(zoned.toPlainDate().toString()).toBe("2026-03-08");
    expect(zoned.hour).toBe(3);
    expect(zoned.minute).toBe(0);
  });
});

describe("missedSummary", () => {
  it("names a single missed task", () => {
    expect(missedSummary(["Gym"])).toBe("Gym passed while Layp was quit");
  });

  it("names up to three tasks and counts a larger backlog", () => {
    expect(missedSummary(["A", "B", "C"])).toBe("A, B, and C passed while Layp was quit");
    expect(missedSummary(["A", "B", "C", "D"])).toBe("4 reminders passed while Layp was quit");
  });

  it("returns null when nothing was missed", () => {
    expect(missedSummary([])).toBeNull();
  });

  it("names two missed tasks", () => {
    expect(missedSummary(["Gym", "Essay"])).toBe("Gym and Essay passed while Layp was quit");
  });
});

describe("reminder schedule", () => {
  const rows = [
    { id: "a", taskId: "t1", title: "Gym", listName: "Inbox", dueOn: "2026-06-02", dueTime: "18:00", minutesBefore: 60 },
    { id: "b", taskId: "t2", title: "Later", listName: "Inbox", dueOn: "2026-06-05", dueTime: "18:00", minutesBefore: 0 },
    { id: "c", taskId: "t3", title: "Soon", listName: "School", dueOn: "2026-06-02", dueTime: "18:00", minutesBefore: 0 },
  ];

  it("keeps due reminders out of the 48 hour timer window", () => {
    const scheduled = scheduleReminders(rows, "UTC");
    const split = splitByHorizon(scheduled, "2026-06-02T17:30:00Z");
    expect(split.due.map((item) => item.id)).toEqual(["a"]);
    expect(split.soon.map((item) => item.id)).toEqual(["c"]);
  });

  it("labels the preset offsets", () => {
    expect(reminderLabel(0)).toBe("At due time");
    expect(reminderLabel(15)).toBe("15 minutes before");
    expect(reminderLabel(60)).toBe("1 hour before");
    expect(reminderLabel(1440)).toBe("1 day before");
  });
});
