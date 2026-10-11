import { describe, expect, it } from "vitest";
import {
  cleanSleep,
  combineSleep,
  planBed,
  planWake,
  sleepBusyLabel,
  sleepNightLabel,
  sleepPrompt,
  sleepWakeLabel,
  suggestedSleepHours,
  type SleepTimes,
} from "./sleep";

function row(day: string, bed: string | null, wake: string | null, hours: number | null = null): SleepTimes {
  return { day, sleepBed: bed, sleepWake: wake, sleepHours: hours };
}

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

describe("planBed", () => {
  it("stores an evening tap on tomorrow, five minutes later", () => {
    const now = new Date(2026, 9, 10, 23, 30);
    expect(planBed(now, [], 5)).toEqual({ kind: "bed", day: "2026-10-11", time: "23:35" });
  });

  it("rolls a five-minute lag past midnight onto the wake day", () => {
    const now = new Date(2026, 9, 10, 23, 58);
    expect(planBed(now, [], 5)).toEqual({ kind: "bed", day: "2026-10-11", time: "00:03" });
  });

  it("stores a tap before 18:00 on today", () => {
    const now = new Date(2026, 9, 11, 0, 10);
    expect(planBed(now, [], 0)).toEqual({ kind: "bed", day: "2026-10-11", time: "00:10" });
    expect(planBed(new Date(2026, 9, 10, 17, 59), [], 0)).toEqual({ kind: "bed", day: "2026-10-10", time: "17:59" });
  });

  it("updates an open night instead of starting another", () => {
    const now = new Date(2026, 9, 10, 23, 40);
    const rows = [row("2026-10-11", "23:30", null)];
    expect(planBed(now, rows, 5)).toEqual({ kind: "bed", day: "2026-10-11", time: "23:45" });
  });

  it("refuses to overwrite a finished night", () => {
    const now = new Date(2026, 9, 11, 14, 0);
    const rows = [row("2026-10-11", "23:30", "07:00", 7.5)];
    expect(planBed(now, rows, 0)).toEqual({ kind: "busy", day: "2026-10-11" });
  });

  it("starts tomorrow when today is already finished and it is evening", () => {
    const now = new Date(2026, 9, 11, 23, 0);
    const rows = [row("2026-10-11", "23:30", "07:00", 7.5)];
    expect(planBed(now, rows, 5)).toEqual({ kind: "bed", day: "2026-10-12", time: "23:05" });
  });
});

describe("planWake", () => {
  it("logs the morning on the night that started the evening before", () => {
    const now = new Date(2026, 9, 11, 7, 0);
    const rows = [row("2026-10-11", "23:30", null)];
    expect(planWake(now, rows)).toEqual({ kind: "wake", day: "2026-10-11", time: "07:00", hours: 7.5 });
  });

  it("keeps hours that were already typed", () => {
    const now = new Date(2026, 9, 11, 7, 0);
    const rows = [row("2026-10-11", "23:30", null, 8)];
    expect(planWake(now, rows)).toEqual({ kind: "wake", day: "2026-10-11", time: "07:00", hours: 8 });
  });

  it("finds a bedtime that was stored on yesterday", () => {
    const now = new Date(2026, 9, 11, 7, 0);
    const plan = planWake(now, [row("2026-10-10", "23:30", null)]);
    expect(plan).toMatchObject({ kind: "wake", day: "2026-10-10", time: "07:00", hours: 7.5 });
  });

  it("does nothing when no night is open", () => {
    expect(planWake(new Date(2026, 9, 11, 7, 0), []).kind).toBe("none");
  });
});

describe("sleepPrompt", () => {
  it("stays quiet in the afternoon when no night is open", () => {
    expect(sleepPrompt(new Date(2026, 9, 11, 14, 0), [], "2026-10-11")).toBe("quiet");
  });

  it("offers bedtime from 18:00 on today", () => {
    expect(sleepPrompt(new Date(2026, 9, 11, 18, 0), [], "2026-10-11")).toBe("bed");
    expect(sleepPrompt(new Date(2026, 9, 11, 17, 59), [], "2026-10-11")).toBe("quiet");
  });

  it("keeps an open night up until it is closed", () => {
    const rows = [row("2026-10-11", "23:30", null)];
    expect(sleepPrompt(new Date(2026, 9, 11, 9, 0), rows, "2026-10-11")).toBe("wake");
    expect(sleepPrompt(new Date(2026, 9, 11, 14, 0), rows, "2026-10-11")).toBe("wake");
  });

  it("finds a bedtime stored on yesterday", () => {
    const rows = [row("2026-10-10", "23:30", null)];
    expect(sleepPrompt(new Date(2026, 9, 11, 9, 0), rows, "2026-10-11")).toBe("wake");
  });

  it("stays quiet on any date that is not today", () => {
    const evening = new Date(2026, 9, 11, 21, 0);
    const open = [row("2026-10-11", "23:30", null)];
    expect(sleepPrompt(evening, [], "2026-10-10")).toBe("quiet");
    expect(sleepPrompt(evening, open, "2026-10-12")).toBe("quiet");
  });
});

describe("combineSleep", () => {
  it("keeps the database value and fills a blank from the form", () => {
    const db = [row("2026-10-11", "23:30", null)];
    const form = row("2026-10-11", "23:40", null);
    expect(combineSleep(db, form)).toEqual([row("2026-10-11", "23:30", null)]);
    expect(combineSleep([row("2026-10-11", null, null)], form)).toEqual([row("2026-10-11", "23:40", null)]);
  });
});

describe("sleep labels", () => {
  const night = new Date(2026, 9, 10, 23, 30);

  it("says when the night is stored on another day", () => {
    expect(sleepNightLabel(night, "2026-10-11", "11:35 PM")).toBe("In bed at 11:35 PM. Logged on tomorrow.");
    expect(sleepNightLabel(night, "2026-10-10", "11:35 PM")).toBe("In bed at 11:35 PM.");
    expect(sleepWakeLabel(new Date(2026, 9, 11, 7, 0), "2026-10-11", "7:00 AM", 7.5)).toBe("Awake at 7:00 AM. 7.5 hours.");
    expect(sleepWakeLabel(new Date(2026, 9, 11, 7, 0), "2026-10-10", "7:00 AM", 7.5)).toBe(
      "Awake at 7:00 AM. 7.5 hours. Logged on yesterday.",
    );
    expect(sleepBusyLabel(new Date(2026, 9, 11, 14, 0), "2026-10-11")).toBe(
      "Today already has a bed time and a wake time.",
    );
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
