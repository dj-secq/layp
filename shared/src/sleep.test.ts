import { describe, expect, it } from "vitest";
import { cleanSleep, suggestedSleepHours } from "./sleep";

describe("suggestedSleepHours", () => {
  it("counts overnight sleep from 23:30 to 07:00 as 7.5", () => {
    expect(suggestedSleepHours("23:30", "07:00")).toBe(7.5);
  });

  it("counts a same-day span", () => {
    expect(suggestedSleepHours("22:15", "23:45")).toBe(1.5);
  });

  it("treats equal times as 0 hours", () => {
    expect(suggestedSleepHours("22:00", "22:00")).toBe(0);
  });

  it("returns null when either time is missing or invalid", () => {
    expect(suggestedSleepHours(null, "07:00")).toBeNull();
    expect(suggestedSleepHours("23:30", null)).toBeNull();
    expect(suggestedSleepHours("25:00", "07:00")).toBeNull();
    expect(suggestedSleepHours("7:00", "08:00")).toBeNull();
  });
});

describe("cleanSleep", () => {
  it("rounds to one decimal and rejects values outside 0 to 24", () => {
    expect(cleanSleep("7.55")).toEqual({ hours: 7.6 });
    expect(cleanSleep("")).toEqual({ hours: null });
    expect(cleanSleep("24")).toEqual({ hours: 24 });
    expect(cleanSleep("24.1")).toEqual({ error: "Sleep hours are from 0 to 24." });
    expect(cleanSleep("-1")).toEqual({ error: "Sleep hours are from 0 to 24." });
  });
});
