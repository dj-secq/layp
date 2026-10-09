import { describe, expect, it } from "vitest";
import { describeRule, firstDueDate, parseRule, rule, serializeRule, type WeekdayCode } from "./recur";
import { draftFromRule, recurrenceDraftError, recurrenceSave } from "./recurEdit";

describe("recurrenceDraftError", () => {
  it("accepts none, including a leftover interval", () => {
    const draft = { ...draftFromRule(null), interval: "0" };
    expect(recurrenceDraftError(draft)).toBeNull();
  });

  it("rejects an interval outside 1 to 99", () => {
    const draft = draftFromRule(rule({ freq: "daily" }));
    expect(recurrenceDraftError({ ...draft, interval: "" })).toBe("Interval is 1 to 99.");
    expect(recurrenceDraftError({ ...draft, interval: "0" })).toBe("Interval is 1 to 99.");
    expect(recurrenceDraftError({ ...draft, interval: "100" })).toBe("Interval is 1 to 99.");
    expect(recurrenceDraftError({ ...draft, interval: "2" })).toBeNull();
  });

  it("accepts a weekly rule with no weekdays and ignores a hidden month day", () => {
    const draft = { ...draftFromRule(rule({ freq: "weekly", byWeekday: null })), monthDay: "40" };
    expect(recurrenceDraftError(draft)).toBeNull();
  });

  it("rejects a month day outside 1 to 31 and accepts an empty one", () => {
    const draft = draftFromRule(rule({ freq: "monthly" }));
    expect(recurrenceDraftError({ ...draft, monthDay: "32" })).toBe("Month day is 1 to 31.");
    expect(recurrenceDraftError({ ...draft, monthDay: "0" })).toBe("Month day is 1 to 31.");
    expect(recurrenceDraftError({ ...draft, monthDay: "" })).toBeNull();
    expect(recurrenceDraftError({ ...draftFromRule(rule({ freq: "yearly" })), monthDay: "31" })).toBeNull();
  });

  it("rejects a count outside 1 to 999 and a missing end date", () => {
    const draft = draftFromRule(rule({ freq: "daily" }));
    expect(recurrenceDraftError({ ...draft, end: "count", endCount: "0" })).toBe("Count is 1 to 999.");
    expect(recurrenceDraftError({ ...draft, end: "count", endCount: "1000" })).toBe("Count is 1 to 999.");
    expect(recurrenceDraftError({ ...draft, end: "count", endCount: "999" })).toBeNull();
    expect(recurrenceDraftError({ ...draft, end: "on", endDate: "" })).toBe("Add an end date.");
    expect(recurrenceDraftError({ ...draft, end: "on", endDate: "2026-10-08" })).toBeNull();
    expect(recurrenceDraftError({ ...draft, end: "never", endCount: "1000" })).toBeNull();
  });
});

describe("recurrenceSave", () => {
  const today = "2026-10-08";

  it("clears the rule and does not set a due date", () => {
    const saved = recurrenceSave(draftFromRule(null), { dueOn: null, dueTime: null }, today, 600);
    expect(saved).toEqual({ recurrence: null });
  });

  it("leaves an existing due date alone", () => {
    const saved = recurrenceSave(draftFromRule(rule({ freq: "daily" })), { dueOn: "2026-10-01", dueTime: "09:00" }, today, 10 * 60);
    expect(saved.recurrence).toEqual(rule({ freq: "daily" }));
    expect(saved.dueOn).toBeUndefined();
  });

  it("sets the first due date when the task has none", () => {
    const value = rule({ freq: "daily" });
    const saved = recurrenceSave(draftFromRule(value), { dueOn: null, dueTime: "09:00" }, today, 10 * 60);
    expect(saved.recurrence).toEqual(value);
    expect(saved.dueOn).toBe(firstDueDate(value, today, "09:00", 10 * 60));
    expect(saved.dueOn).toBe("2026-10-09");
  });

  it("stores no selected weekdays as null and drops a hidden month day", () => {
    const draft = { ...draftFromRule(rule({ freq: "weekly" })), weekdays: [] as WeekdayCode[], monthDay: "4" };
    const saved = recurrenceSave(draft, { dueOn: "2026-10-08", dueTime: null }, today, null);
    expect(saved.recurrence?.byWeekday).toBeNull();
    expect(saved.recurrence?.byMonthDay).toBeNull();
    expect(parseRule(serializeRule(saved.recurrence!))).toEqual(saved.recurrence);
  });

  it("stores an empty month day as null", () => {
    const draft = { ...draftFromRule(rule({ freq: "yearly", byMonthDay: 4 })), monthDay: "" };
    const saved = recurrenceSave(draft, { dueOn: "2026-03-01", dueTime: null }, today, null);
    expect(saved.dueOn).toBeUndefined();
    expect(saved.recurrence).toEqual(rule({ freq: "yearly", byMonthDay: null }));
  });

  it("saves every 2 weeks on Monday and Friday, from completion, after 3 times", () => {
    const draft = {
      ...draftFromRule(rule({ freq: "weekly", interval: 2, byWeekday: ["MO", "FR"] })),
      basis: "completed" as const,
      end: "count" as const,
      endCount: "3",
    };
    const saved = recurrenceSave(draft, { dueOn: "2026-10-05", dueTime: null }, today, null);
    const expected = rule({
      freq: "weekly",
      interval: 2,
      byWeekday: ["MO", "FR"],
      basis: "completed",
      end: { type: "count", remaining: 3 },
    });
    expect(saved.recurrence).toEqual(expected);
    expect(describeRule(saved.recurrence!)).toBe("Every 2 weeks on Monday, Friday");
    expect(saved.dueOn).toBeUndefined();
  });
});
