import { describe, expect, it } from "vitest";
import { firstDueDate, nextDueDate, parseRule, rule, ruleAfterComplete, serializeRule } from "./recur";

describe("nextDueDate", () => {
  it("steps a daily rule by one day", () => {
    expect(nextDueDate(rule({ freq: "daily" }), "2026-10-04")).toBe("2026-10-05");
  });

  it("rolls a weekday rule from Friday to Monday", () => {
    const value = rule({ freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] });
    expect(nextDueDate(value, "2026-10-02")).toBe("2026-10-05");
  });

  it("clamps the 31st to February and returns to the 31st in March", () => {
    const value = rule({ freq: "monthly", byMonthDay: 31 });
    expect(nextDueDate(value, "2026-01-31")).toBe("2026-02-28");
    expect(nextDueDate(value, "2026-02-28")).toBe("2026-03-31");
    expect(nextDueDate(value, "2024-01-31")).toBe("2024-02-29");
  });

  it("stops when the remaining count is the open occurrence", () => {
    const value = rule({ freq: "daily", end: { type: "count", remaining: 1 } });
    expect(nextDueDate(value, "2026-10-04")).toBeNull();
    expect(ruleAfterComplete(value)).toBeNull();
  });

  it("decrements a count that still has a following occurrence", () => {
    const value = rule({ freq: "daily", end: { type: "count", remaining: 2 } });
    expect(nextDueDate(value, "2026-10-04")).toBe("2026-10-05");
    expect(ruleAfterComplete(value)?.end).toEqual({ type: "count", remaining: 1 });
  });

  it("stops after the end date", () => {
    const value = rule({ freq: "daily", end: { type: "on", date: "2026-10-04" } });
    expect(nextDueDate(value, "2026-10-04")).toBeNull();
  });
});

describe("firstDueDate", () => {
  it("uses today for a daily rule before the time has passed", () => {
    expect(firstDueDate(rule({ freq: "daily" }), "2026-10-04", "09:00", 8 * 60)).toBe("2026-10-04");
  });

  it("moves a passed weekday time to the next matching day", () => {
    const value = rule({ freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] });
    expect(firstDueDate(value, "2026-10-05", "09:00", 10 * 60)).toBe("2026-10-06");
  });
});

describe("parseRule", () => {
  it("round-trips a rule", () => {
    const value = rule({ freq: "weekly", byWeekday: ["MO", "FR"], interval: 2 });
    expect(parseRule(serializeRule(value))).toEqual(value);
  });
});
