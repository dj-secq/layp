import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import {
  averageSleep,
  cellScheduled,
  cleanLog,
  cleanTrackerDraft,
  dayObligation,
  dayShownUp,
  isSuccess,
  leadingHobby,
  parseSchedule,
  serializeSchedule,
  streak,
  sumMinutes,
  weekBounds,
  weekBuckets,
  type LogMark,
  type Schedule,
} from "./journal";

function onOrBefore(iso: string, dayOfWeek: number): string {
  let date = Temporal.PlainDate.from(iso);
  while (date.dayOfWeek !== dayOfWeek) date = date.subtract({ days: 1 });
  return date.toString();
}

function done(day: string, value: number | null = null): LogMark {
  return { day, state: "done", value };
}

function skipped(day: string): LogMark {
  return { day, state: "skipped", value: null };
}

describe("parseSchedule", () => {
  it("round-trips daily, weekdays, and weekly count", () => {
    const schedules: Schedule[] = [
      { type: "daily" },
      { type: "weekdays", days: [1, 2, 3, 4, 5] },
      { type: "weekly_count", count: 4 },
    ];
    for (const schedule of schedules) {
      const json = serializeSchedule(schedule);
      expect(json).not.toMatch(/\s/);
      expect(parseSchedule(json)).toEqual(schedule);
    }
    expect(serializeSchedule({ type: "weekdays", days: [5, 1, 1, 3] })).toBe(
      '{"type":"weekdays","days":[1,3,5]}',
    );
    expect(parseSchedule('{"type":"weekdays","days":[5,1,5,3]}')).toEqual({
      type: "weekdays",
      days: [1, 3, 5],
    });
  });

  it("parses invalid JSON and unrecognized shapes as daily", () => {
    expect(parseSchedule("{")).toEqual({ type: "daily" });
    expect(parseSchedule("null")).toEqual({ type: "daily" });
    expect(parseSchedule('{"type":"nope"}')).toEqual({ type: "daily" });
    expect(parseSchedule('{"type":"weekdays","days":[]}')).toEqual({ type: "daily" });
    expect(parseSchedule('{"type":"weekdays","days":[0,8]}')).toEqual({ type: "daily" });
    expect(parseSchedule('{"type":"weekly_count","count":0}')).toEqual({ type: "daily" });
    expect(parseSchedule('{"type":"weekly_count","count":8}')).toEqual({ type: "daily" });
    expect(parseSchedule('{"type":"weekly_count","count":4.5}')).toEqual({ type: "daily" });
  });

  it("schedules a cell every day for daily and weekly count, and only chosen weekdays otherwise", () => {
    const monday = onOrBefore("2026-03-04", 1);
    const tuesday = addDays(monday, 1);
    expect(cellScheduled({ type: "daily" }, tuesday)).toBe(true);
    expect(cellScheduled({ type: "weekly_count", count: 4 }, tuesday)).toBe(true);
    expect(dayObligation({ type: "weekly_count", count: 4 }, tuesday)).toBe(false);
    expect(cellScheduled({ type: "weekdays", days: [1, 5] }, monday)).toBe(true);
    expect(cellScheduled({ type: "weekdays", days: [1, 5] }, tuesday)).toBe(false);
    expect(dayObligation({ type: "weekdays", days: [1, 5] }, monday)).toBe(true);
  });
});

describe("isSuccess", () => {
  it("accepts a done check and rejects a missing or skipped log", () => {
    expect(isSuccess("check", null, null)).toBe(false);
    expect(isSuccess("check", null, skipped("2026-03-04"))).toBe(false);
    expect(isSuccess("check", null, done("2026-03-04"))).toBe(true);
  });

  it("compares counts, numbers, and minutes with the daily target", () => {
    expect(isSuccess("count", null, done("2026-03-04", 1))).toBe(true);
    expect(isSuccess("count", null, done("2026-03-04", 0))).toBe(false);
    expect(isSuccess("count", 3, done("2026-03-04", 3))).toBe(true);
    expect(isSuccess("number", null, done("2026-03-04", 0))).toBe(true);
    expect(isSuccess("number", 2, done("2026-03-04", 1.5))).toBe(false);
    expect(isSuccess("scale", null, done("2026-03-04", 4))).toBe(true);
    expect(isSuccess("minutes", null, done("2026-03-04", 0))).toBe(false);
    expect(isSuccess("minutes", 30, done("2026-03-04", 30))).toBe(true);
    expect(isSuccess("minutes", 30, done("2026-03-04", 10))).toBe(false);
  });
});

describe("streak", () => {
  const today = "2026-03-04";
  const daily = { type: "daily" } as const;

  it("counts yesterday when today is empty and does not call today a miss", () => {
    const result = streak({
      kind: "check",
      dailyTarget: null,
      schedule: daily,
      logs: [done(addDays(today, -1))],
      today,
      weekStart: "monday",
    });
    expect(result.streak).toBeGreaterThanOrEqual(1);
    expect(result).toEqual({ streak: 1, label: "1", todayIsMiss: false });
  });

  it("steps over a skip without counting it", () => {
    const result = streak({
      kind: "check",
      dailyTarget: null,
      schedule: daily,
      logs: [
        done(addDays(today, -1)),
        skipped(addDays(today, -2)),
        done(addDays(today, -3)),
        done(addDays(today, -4)),
      ],
      today,
      weekStart: "monday",
    });
    expect(result).toEqual({ streak: 3, label: "3", todayIsMiss: false });
  });

  it("stops at a day with no log", () => {
    const result = streak({
      kind: "check",
      dailyTarget: null,
      schedule: daily,
      logs: [done(addDays(today, -1)), done(addDays(today, -3))],
      today,
      weekStart: "monday",
    });
    expect(result).toEqual({ streak: 1, label: "1", todayIsMiss: false });
  });

  it("extends the streak when today is done", () => {
    const result = streak({
      kind: "check",
      dailyTarget: null,
      schedule: daily,
      logs: [done(today), done(addDays(today, -1))],
      today,
      weekStart: "monday",
    });
    expect(result).toEqual({ streak: 2, label: "2", todayIsMiss: false });
  });

  it("does not treat a failed done today as part of the streak, but keeps the earlier chain", () => {
    const result = streak({
      kind: "minutes",
      dailyTarget: null,
      schedule: daily,
      logs: [done(today, 0), done(addDays(today, -1), 20)],
      today,
      weekStart: "monday",
    });
    expect(result).toEqual({ streak: 1, label: "1", todayIsMiss: true });
  });

  it("does not treat Saturday as a miss between Friday and Monday", () => {
    const monday = onOrBefore(today, 1);
    const friday = addDays(monday, -3);
    const thursday = addDays(monday, -4);
    expect(Temporal.PlainDate.from(friday).dayOfWeek).toBe(5);
    expect(Temporal.PlainDate.from(addDays(monday, -2)).dayOfWeek).toBe(6);
    const result = streak({
      kind: "check",
      dailyTarget: null,
      schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] },
      logs: [done(monday), done(friday), done(thursday)],
      today: monday,
      weekStart: "monday",
    });
    expect(result).toEqual({ streak: 3, label: "3", todayIsMiss: false });
  });

  it("leaves an off-day today out of the miss state", () => {
    const monday = onOrBefore(today, 1);
    const saturday = addDays(monday, -2);
    const friday = addDays(monday, -3);
    const result = streak({
      kind: "check",
      dailyTarget: null,
      schedule: { type: "weekdays", days: [1, 5] },
      logs: [done(friday)],
      today: saturday,
      weekStart: "monday",
    });
    expect(result).toEqual({ streak: 1, label: "1", todayIsMiss: false });
  });

  it("labels the open weekly count and counts only earlier full weeks", () => {
    const current = weekBounds(today, "monday");
    const previous = weekBounds(addDays(current.start, -1), "monday");
    const before = weekBounds(addDays(previous.start, -1), "monday");
    const logs = [
      done(current.start),
      done(addDays(current.start, 1)),
      skipped(addDays(current.start, 2)),
      ...[0, 1, 2, 3].map((offset) => done(addDays(previous.start, offset))),
    ];
    const met = streak({
      kind: "check",
      dailyTarget: null,
      schedule: { type: "weekly_count", count: 4 },
      logs,
      today,
      weekStart: "monday",
    });
    expect(met).toEqual({ streak: 1, label: "2 of 4", todayIsMiss: false });

    const stopped = streak({
      kind: "check",
      dailyTarget: null,
      schedule: { type: "weekly_count", count: 4 },
      logs: [
        done(current.start),
        done(addDays(current.start, 1)),
        done(previous.start),
        ...[0, 1, 2, 3].map((offset) => done(addDays(before.start, offset))),
      ],
      today,
      weekStart: "monday",
    });
    expect(stopped).toEqual({ streak: 0, label: "2 of 4", todayIsMiss: false });
  });

  it("does not add the current week to a weekly streak even when the count is already met", () => {
    const current = weekBounds(today, "monday");
    const result = streak({
      kind: "check",
      dailyTarget: null,
      schedule: { type: "weekly_count", count: 4 },
      logs: [0, 1, 2, 3].map((offset) => done(addDays(current.start, offset))),
      today,
      weekStart: "monday",
    });
    expect(result).toEqual({ streak: 0, label: "4 of 4", todayIsMiss: false });
  });
});

describe("leadingHobby", () => {
  it("picks the most minutes and counts the other positive hobbies", () => {
    expect(
      leadingHobby([
        { id: "guitar", color: "#c45c26", minutes: 40 },
        { id: "piano", color: "#2f6f4e", minutes: 10 },
        { id: "rest", color: "#888888", minutes: 0 },
      ]),
    ).toEqual({ color: "#c45c26", extra: 1 });
  });

  it("breaks ties by the smallest id and returns null when nothing was logged", () => {
    expect(
      leadingHobby([
        { id: "b", color: "#111111", minutes: 10 },
        { id: "a", color: "#222222", minutes: 10 },
      ]),
    ).toEqual({ color: "#222222", extra: 1 });
    expect(leadingHobby([{ id: "a", color: "#222222", minutes: 0 }])).toBeNull();
  });
});

describe("dayShownUp", () => {
  it("is true for hobby minutes alone", () => {
    expect(
      dayShownUp({ taskCompleted: false, workoutYes: false, hobbyMinutes: 15, trackerDone: false }),
    ).toBe(true);
    expect(
      dayShownUp({ taskCompleted: false, workoutYes: false, hobbyMinutes: 0, trackerDone: false }),
    ).toBe(false);
  });
});

describe("week bounds", () => {
  it("uses Monday or Sunday as the week start", () => {
    const wednesday = "2026-03-04";
    expect(Temporal.PlainDate.from(wednesday).dayOfWeek).toBe(3);
    expect(weekBounds(wednesday, "monday")).toEqual({ start: "2026-03-02", end: "2026-03-08" });
    expect(weekBounds(wednesday, "sunday")).toEqual({ start: "2026-03-01", end: "2026-03-07" });
    expect(weekBuckets(wednesday, "monday", 2)).toEqual([
      { start: "2026-02-23", end: "2026-03-01" },
      { start: "2026-03-02", end: "2026-03-08" },
    ]);
  });
});

describe("sumMinutes", () => {
  it("ignores skipped logs and non-positive values", () => {
    expect(
      sumMinutes(
        [
          done("2026-03-01", 40),
          skipped("2026-03-02"),
          { day: "2026-03-02", state: "skipped", value: 15 },
          done("2026-03-03", 0),
          done("2026-03-04", null),
          done("2026-03-10", 5),
        ],
        "2026-03-01",
        "2026-03-04",
      ),
    ).toBe(40);
  });
});

describe("averageSleep", () => {
  it("ignores null and rounds to one decimal", () => {
    expect(averageSleep([7, null, 8])).toBe(7.5);
    expect(averageSleep([null, Number.NaN])).toBeNull();
  });
});

describe("cleanTrackerDraft", () => {
  it("forces a hobby to minutes on a daily schedule", () => {
    expect(
      cleanTrackerDraft({
        name: "  Guitar  ",
        kind: "check",
        unit: "hrs",
        target: "10",
        schedule: { type: "weekdays", days: [] },
        hobby: true,
      }),
    ).toEqual({
      ok: true,
      name: "Guitar",
      kind: "minutes",
      unit: null,
      dailyTarget: null,
      schedule: { type: "daily" },
    });
  });

  it("rejects an empty name, an empty weekday set, and a missing count target", () => {
    expect(
      cleanTrackerDraft({
        name: " ",
        kind: "check",
        unit: "",
        target: "",
        schedule: { type: "daily" },
        hobby: false,
      }),
    ).toEqual({ ok: false, error: "Add a name." });
    expect(
      cleanTrackerDraft({
        name: "Read",
        kind: "check",
        unit: "",
        target: "",
        schedule: { type: "weekdays", days: [8] },
        hobby: false,
      }),
    ).toEqual({ ok: false, error: "Pick at least one day." });
    expect(
      cleanTrackerDraft({
        name: "Pages",
        kind: "count",
        unit: "pages",
        target: "",
        schedule: { type: "weekly_count", count: 4 },
        hobby: false,
      }),
    ).toEqual({ ok: false, error: "Add a target of at least 1." });
  });
});

describe("cleanLog", () => {
  it("clears the value when a check is skipped", () => {
    expect(
      cleanLog({ kind: "check", state: "skipped", valueText: "1", note: "  rest  " }),
    ).toEqual({ ok: true, state: "skipped", value: null, note: "rest" });
  });

  it("stores a check without a value and rejects an empty minutes entry", () => {
    expect(cleanLog({ kind: "check", state: "done", valueText: "9", note: "ok" })).toEqual({
      ok: true,
      state: "done",
      value: null,
      note: "ok",
    });
    expect(cleanLog({ kind: "minutes", state: "done", valueText: "", note: "" })).toEqual({
      ok: false,
      error: "Minutes are a whole number, 0 or more.",
    });
    expect(cleanLog({ kind: "minutes", state: "done", valueText: "0", note: "" })).toEqual({
      ok: true,
      state: "done",
      value: 0,
      note: "",
    });
  });
});
