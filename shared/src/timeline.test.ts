import { describe, expect, it } from "vitest";
import { timelineDays, timelineGroups, type TimelineTask } from "./timeline";

function task(partial: Partial<TimelineTask> & Pick<TimelineTask, "id" | "title">): TimelineTask {
  return {
    parentId: null,
    listId: "inbox",
    startOn: null,
    dueOn: null,
    sortOrder: 0,
    ...partial,
  };
}

describe("timelineDays", () => {
  it("starts the default six-week range on the week start", () => {
    const days = timelineDays("2026-10-04", "6w", "monday");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-09-28");
    expect(days).toContain("2026-10-04");
  });

  it("uses fourteen days for two weeks and sunday as the week start", () => {
    const days = timelineDays("2026-10-04", "2w", "sunday");
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-10-04");
  });
});

describe("timelineGroups", () => {
  const first = "2026-09-28";
  const last = "2026-11-08";

  it("indents dated descendants and leaves undated ones off the chart", () => {
    const groups = timelineGroups(
      [
        task({ id: "parent", title: "Timeline check", dueOn: "2026-10-06", sortOrder: 1 }),
        task({ id: "child", title: "Dated child", parentId: "parent", dueOn: "2026-10-08", sortOrder: 0 }),
        task({ id: "plain", title: "No date", parentId: "parent", sortOrder: 1 }),
        task({ id: "later", title: "Under the undated one", parentId: "plain", dueOn: "2026-10-09", sortOrder: 0 }),
      ],
      ["inbox"],
      first,
      last,
    );
    expect(groups.map((group) => group.rows.map((row) => [row.task.id, row.depth, row.bar]))).toEqual([
      [
        ["parent", 0, true],
        ["child", 1, true],
        ["later", 2, true],
      ],
    ]);
  });

  it("groups by list order and skips dates outside the range", () => {
    const groups = timelineGroups(
      [
        task({ id: "school", title: "School", listId: "school", dueOn: "2026-10-05", sortOrder: 0 }),
        task({ id: "far", title: "Next year", dueOn: "2027-01-02", sortOrder: 0 }),
        task({ id: "inbox", title: "Inbox", dueOn: "2026-10-04", sortOrder: 1 }),
      ],
      ["inbox", "school"],
      first,
      last,
    );
    expect(groups.map((group) => [group.listId, group.rows.map((row) => row.task.id)])).toEqual([
      ["inbox", ["inbox"]],
      ["school", ["school"]],
    ]);
  });
});
