import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { addDays, monthCells } from "./dates";

describe("addDays", () => {
  it("steps across a month boundary as a civil date", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("monthCells", () => {
  it("starts a Monday-first January 2024 on Monday", () => {
    const cells = monthCells(2024, 1, "monday");
    expect(Temporal.PlainDate.from("2024-01-01").dayOfWeek).toBe(1);
    expect(cells[0]).toBe("2024-01-01");
    expect(cells).toHaveLength(35);
  });

  it("leaves Sunday blank when the month starts on Monday and the week starts Sunday", () => {
    const cells = monthCells(2024, 1, "sunday");
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe("2024-01-01");
  });
});
