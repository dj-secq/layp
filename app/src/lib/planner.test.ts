import { describe, expect, it } from "vitest";
import { countdownLabel, describeEdit, emptyRule, matchFilter, movedIds, sortTasks } from "./planner";
import { formatRemaining, pausedOnLaunch, skipPhase, stepTimer } from "./pomo";
import { countsByDay, dayReading, daysAround, daysEnding, trackerRate, trackerTone } from "./stats";

describe("planner", () => {
  const tasks = [
    { id: "a", sortOrder: 2, dueOn: "2026-10-06", dueTime: null, priority: "low" as const, createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "b", sortOrder: 1, dueOn: null, dueTime: null, priority: "high" as const, createdAt: "2026-10-03T00:00:00.000Z" },
  ];

  it("sorts by due date with undated tasks last", () => {
    expect(sortTasks(tasks, "due").map((task) => task.id)).toEqual(["a", "b"]);
  });

  it("sorts high priority ahead of low", () => {
    expect(sortTasks(tasks, "priority").map((task) => task.id)).toEqual(["b", "a"]);
  });

  it("moves an id between its neighbors", () => {
    expect(movedIds(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(movedIds(["a"], "a", -1)).toBeNull();
  });

  it("matches an overdue open task and rejects a different list", () => {
    const rule = { ...emptyRule(), listId: "inbox", due: "overdue" as const };
    const task = {
      listId: "inbox",
      priority: "none" as const,
      dueOn: "2026-10-01",
      completedAt: null,
      important: false,
      urgent: false,
      tagIds: [],
    };
    expect(matchFilter(task, rule, "2026-10-04")).toBe(true);
    expect(matchFilter({ ...task, listId: "school" }, rule, "2026-10-04")).toBe(false);
    expect(matchFilter({ ...task, completedAt: "2026-10-02T00:00:00.000Z" }, rule, "2026-10-04")).toBe(false);
  });

  it("labels countdowns before and after the date", () => {
    expect(countdownLabel("2026-10-07", "2026-10-04")).toBe("3 days");
    expect(countdownLabel("2026-10-04", "2026-10-04")).toBe("Today");
    expect(countdownLabel("2026-10-02", "2026-10-04")).toBe("2 days ago");
  });

  it("describes an edit without the new title", () => {
    expect(describeEdit({ title: true, dates: true })).toBe("Title and Dates changed");
    expect(describeEdit({})).toBeNull();
  });
});

describe("pomodoro", () => {
  it("restores a running timer as paused", () => {
    const paused = pausedOnLaunch({ taskId: "t", phase: "work", running: true, remainingSeconds: 40 });
    expect(paused.running).toBe(false);
    expect(paused.remainingSeconds).toBe(40);
  });

  it("finishes a work second at zero and starts the break", () => {
    const stepped = stepTimer({ taskId: "t", phase: "work", running: true, remainingSeconds: 1 }, 25 * 60, 5 * 60);
    expect(stepped.finishedWork).toBe(true);
    expect(stepped.elapsedWorkMinutes).toBe(25);
    expect(stepped.timer.phase).toBe("break");
    expect(stepped.timer.remainingSeconds).toBe(300);
  });

  it("records only the minutes already spent when a work interval is skipped", () => {
    const skipped = skipPhase({ taskId: null, phase: "work", running: true, remainingSeconds: 20 * 60 }, 25 * 60, 5 * 60);
    expect(skipped.elapsedWorkMinutes).toBe(5);
    expect(skipped.timer.phase).toBe("break");
    expect(formatRemaining(65)).toBe("01:05");
  });
});

describe("stats", () => {
  it("counts completions on the days in range", () => {
    expect(daysEnding("2026-10-04", 3)).toEqual(["2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(daysAround("2026-10-05", 7)).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    const month = daysAround("2026-10-05", 28);
    expect(month).toHaveLength(28);
    expect(month[13]).toBe("2026-10-05");
    expect(month[0]).toBe("2026-09-22");
    expect(month[27]).toBe("2026-10-19");
    expect(countsByDay(["2026-10-03", "2026-10-04"], ["2026-10-04", "2026-10-04", "2026-10-01"])).toEqual([0, 2]);
  });

  it("excludes today and skipped days from a tracker rate", () => {
    const rate = trackerRate({
      kind: "check",
      dailyTarget: null,
      schedule: { type: "daily" },
      today: "2026-10-04",
      start: "2026-10-02",
      logs: [
        { day: "2026-10-02", state: "done", value: null },
        { day: "2026-10-03", state: "skipped", value: null },
        { day: "2026-10-04", state: "done", value: null },
      ],
    });
    expect(rate).toEqual({ met: 1, scheduled: 1 });
  });

  it("reads a low mood as down even when the day was busy", () => {
    expect(dayReading({ mood: 2, tasks: 4, focus: 25, workout: true, hobbyHits: 1, trackerHits: 2 })).toBe("down");
    expect(dayReading({ mood: 1, tasks: 0, focus: 0, workout: false, hobbyHits: 0, trackerHits: 0 })).toBe("down");
  });

  it("reads two marks as productive and one mark as quiet", () => {
    expect(dayReading({ mood: 4, tasks: 1, focus: 0, workout: false, hobbyHits: 0, trackerHits: 0 })).toBe("productive");
    expect(dayReading({ mood: null, tasks: 2, focus: 0, workout: false, hobbyHits: 0, trackerHits: 0 })).toBe("productive");
    expect(dayReading({ mood: null, tasks: 0, focus: 0, workout: false, hobbyHits: 0, trackerHits: 2 })).toBe("productive");
    expect(dayReading({ mood: 4, tasks: 0, focus: 0, workout: false, hobbyHits: 0, trackerHits: 0 })).toBe("quiet");
    expect(dayReading({ mood: 3, tasks: 1, focus: 0, workout: false, hobbyHits: 0, trackerHits: 0 })).toBe("quiet");
    expect(dayReading({ mood: null, tasks: 0, focus: 40, workout: false, hobbyHits: 0, trackerHits: 0 })).toBe("quiet");
  });

  it("keeps today open and marks a past gap", () => {
    const daily = { kind: "check" as const, dailyTarget: null, schedule: { type: "daily" as const } };
    expect(trackerTone({ ...daily, log: null, day: "2026-10-04", today: "2026-10-04" })).toBe("empty");
    expect(trackerTone({ ...daily, log: null, day: "2026-10-03", today: "2026-10-04" })).toBe("miss");
    expect(
      trackerTone({
        ...daily,
        log: { day: "2026-10-03", state: "skipped", value: null },
        day: "2026-10-03",
        today: "2026-10-04",
      }),
    ).toBe("skip");
    expect(
      trackerTone({
        ...daily,
        log: { day: "2026-10-03", state: "done", value: null },
        day: "2026-10-03",
        today: "2026-10-04",
      }),
    ).toBe("fill");
    expect(
      trackerTone({
        kind: "count",
        dailyTarget: 5,
        schedule: { type: "daily" },
        log: { day: "2026-10-03", state: "done", value: 1 },
        day: "2026-10-03",
        today: "2026-10-04",
      }),
    ).toBe("miss");
    expect(
      trackerTone({
        kind: "check",
        dailyTarget: null,
        schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] },
        log: null,
        day: "2026-10-04",
        today: "2026-10-05",
      }),
    ).toBe("empty");
    expect(
      trackerTone({
        kind: "check",
        dailyTarget: null,
        schedule: { type: "weekly_count", count: 3 },
        log: null,
        day: "2026-10-03",
        today: "2026-10-04",
      }),
    ).toBe("empty");
  });
});
