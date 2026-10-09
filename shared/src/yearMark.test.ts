import { describe, expect, it } from "vitest";
import { sleepRangeLabel, yearBarColor } from "./yearMark";

const blank = {
  mood: null,
  shown: false,
  sleepHours: null,
  workoutYes: false,
  taskCompleted: false,
  hobbyColor: null,
};

describe("yearBarColor", () => {
  it("puts a mood color on the bar and leaves an empty day clear", () => {
    expect(yearBarColor({ ...blank, mode: "mood", mood: 1 })).toBe("#ff6b6b");
    expect(yearBarColor({ ...blank, mode: "mood", mood: 5 })).toBe("#86efac");
    expect(yearBarColor({ ...blank, mode: "mood" })).toBeNull();
  });

  it("uses one color per mode", () => {
    expect(yearBarColor({ ...blank, mode: "shown", shown: true })).toBe("#ffdc58");
    expect(yearBarColor({ ...blank, mode: "sleep", sleepHours: 7.5 })).toBe("#7dd3fc");
    expect(yearBarColor({ ...blank, mode: "workout", workoutYes: true })).toBe("#86efac");
    expect(yearBarColor({ ...blank, mode: "tasks", taskCompleted: true })).toBe("#ffdc58");
    expect(yearBarColor({ ...blank, mode: "hobby", hobbyColor: "#c4b5fd" })).toBe("#c4b5fd");
    expect(yearBarColor({ ...blank, mode: "hobby" })).toBeNull();
    expect(yearBarColor({ ...blank, mode: "sleep" })).toBeNull();
  });
});

describe("sleepRangeLabel", () => {
  it("lists the hours that were recorded", () => {
    expect(sleepRangeLabel([null, null])).toBe("No sleep recorded");
    expect(sleepRangeLabel([7.5])).toBe("7.5 hours");
    expect(sleepRangeLabel([6, 8.5, null])).toBe("6.0–8.5 hours");
  });
});
