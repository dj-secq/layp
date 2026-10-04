import { describe, expect, it } from "vitest";
import { groupTasksForDay, type DayTask } from "./today";

function task(partial: Partial<DayTask> & Pick<DayTask, "id">): DayTask {
  return {
    pinned: false,
    startOn: null,
    dueOn: null,
    completedAt: null,
    deletedAt: null,
    ...partial,
  };
}

describe("groupTasksForDay", () => {
  const today = "2026-10-04";

  it("puts pinned, overdue, due, and completed tasks in their groups", () => {
    const groups = groupTasksForDay(
      [
        task({ id: "pin", pinned: true, dueOn: today }),
        task({ id: "late", dueOn: "2026-10-01" }),
        task({ id: "due", dueOn: today }),
        task({ id: "start", startOn: today, dueOn: "2026-10-09" }),
        task({ id: "done", dueOn: today, completedAt: "2026-10-04T12:00:00.000Z" }),
        task({ id: "gone", dueOn: today, deletedAt: "2026-10-04T12:00:00.000Z" }),
      ],
      today,
      today,
    );
    expect(groups.pinned.map((item) => item.id)).toEqual(["pin"]);
    expect(groups.overdue.map((item) => item.id)).toEqual(["late"]);
    expect(groups.scheduled.map((item) => item.id)).toEqual(["due", "start"]);
    expect(groups.completed.map((item) => item.id)).toEqual(["done"]);
  });

  it("hides the overdue and pinned piles on any date other than today", () => {
    const groups = groupTasksForDay(
      [task({ id: "late", dueOn: "2026-10-01" }), task({ id: "pin", pinned: true }), task({ id: "due", dueOn: "2026-10-03" })],
      "2026-10-03",
      today,
    );
    expect(groups.pinned).toEqual([]);
    expect(groups.overdue).toEqual([]);
    expect(groups.scheduled.map((item) => item.id)).toEqual(["due"]);
  });
});
