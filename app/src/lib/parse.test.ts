import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { parseQuickAdd, type QuickList } from "./parse";

const lists: QuickList[] = [
  { id: "inbox", name: "Inbox" },
  { id: "school", name: "School" },
];

const sunday = { today: "2026-10-04", minutes: 15 * 60 };

describe("parseQuickAdd", () => {
  it("creates an inbox task with no date from a plain title", () => {
    const result = parseQuickAdd("buy milk", lists, sunday);
    expect(result).toMatchObject({ status: "ok", title: "buy milk", listId: null, dueOn: null, dueTime: null, priority: "none" });
  });

  it("sets tomorrow", () => {
    const result = parseQuickAdd("pay rent tomorrow", lists, sunday);
    expect(result).toMatchObject({ status: "ok", title: "pay rent", dueOn: "2026-10-05" });
  });

  it("puts gym on the coming Friday at 18:00", () => {
    const result = parseQuickAdd("gym friday 6pm", lists, sunday);
    expect(result).toMatchObject({ status: "ok", title: "gym", dueOn: "2026-10-09", dueTime: "18:00" });
    expect(Temporal.PlainDate.from("2026-10-09").dayOfWeek).toBe(5);
  });

  it("keeps Friday today when that weekday is named and no time is set", () => {
    const result = parseQuickAdd("gym friday", lists, { today: "2026-10-09", minutes: 20 * 60 });
    expect(result).toMatchObject({ dueOn: "2026-10-09" });
  });

  it("moves Friday to next week when the time has passed", () => {
    const result = parseQuickAdd("gym friday 6pm", lists, { today: "2026-10-09", minutes: 19 * 60 });
    expect(result).toMatchObject({ dueOn: "2026-10-16", dueTime: "18:00" });
  });

  it("puts a high-priority essay in School and marks it important", () => {
    const result = parseQuickAdd("essay p1 in School", lists, sunday);
    expect(result).toMatchObject({
      status: "ok",
      title: "essay",
      listId: "school",
      priority: "high",
      important: true,
      notice: null,
    });
  });

  it("leaves an unknown list in the title and names it", () => {
    const result = parseQuickAdd("essay in NoSuch", lists, sunday);
    expect(result).toMatchObject({
      status: "ok",
      title: "essay in NoSuch",
      listId: null,
      notice: "No list named NoSuch.",
    });
  });

  it("schedules a weekday recurrence at 09:00", () => {
    const result = parseQuickAdd("stand up every weekday 9am", lists, sunday);
    expect(result).toMatchObject({
      status: "ok",
      title: "stand up",
      dueTime: "09:00",
      dueOn: "2026-10-05",
      recurrence: { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"], interval: 1 },
    });
  });

  it("uses 21:00 for tonight when no time was typed", () => {
    const result = parseQuickAdd("call tonight", lists, sunday);
    expect(result).toMatchObject({ title: "call", dueOn: "2026-10-04", dueTime: "21:00" });
  });

  it("rejects a line that is only a date", () => {
    expect(parseQuickAdd("tomorrow", lists, sunday)).toEqual({ status: "reject" });
  });

  it("ignores an empty line", () => {
    expect(parseQuickAdd("   ", lists, sunday)).toEqual({ status: "empty" });
  });

  it("reads a month day on or after today", () => {
    const result = parseQuickAdd("rent Oct 4", lists, sunday);
    expect(result).toMatchObject({ title: "rent", dueOn: "2026-10-04" });
  });
});
