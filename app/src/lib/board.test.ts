import { expect, it } from "vitest";
import type { Task } from "../db/types";
import { boardColumns, boardDrop, tagsOnCard } from "../screens/BoardScreen";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    seriesId: "s1",
    listId: "list",
    sectionId: "alpha",
    parentId: null,
    title: "Milk",
    notes: "",
    priority: "none",
    important: false,
    urgent: false,
    pinned: false,
    startOn: null,
    dueOn: null,
    dueTime: null,
    durationMinutes: null,
    recurrenceJson: null,
    estimatedPomos: null,
    completedPomos: 0,
    sortOrder: 0,
    completedAt: null,
    deletedAt: null,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
    ...overrides,
  };
}

const alpha = { id: "alpha", name: "Alpha", sortOrder: 0 };
const zebra = { id: "zebra", name: "Zebra", sortOrder: 0 };
const middle = { id: "middle", name: "Middle", sortOrder: 1 };

it("sorts columns by sort order then name and parks a null section in the first", () => {
  const columns = boardColumns(
    [zebra, middle, alpha],
    [
      task({ id: "loose", sectionId: null, title: "Loose", sortOrder: 2 }),
      task({ id: "named", sectionId: "zebra", title: "Named", sortOrder: 0 }),
      task({ id: "later", sectionId: "alpha", title: "Later", sortOrder: 1, createdAt: "2026-10-09T00:00:00.000Z" }),
      task({ id: "sooner", sectionId: "alpha", title: "Sooner", sortOrder: 1, createdAt: "2026-10-01T00:00:00.000Z" }),
      task({ id: "finished", sectionId: "alpha", completedAt: "2026-10-08T01:00:00.000Z" }),
    ],
  );
  expect(columns.map((column) => column.name)).toEqual(["Alpha", "Zebra", "Middle", "Done"]);
  expect(columns[0]?.tasks.map((item) => item.id)).toEqual(["sooner", "later", "loose"]);
  expect(columns[1]?.tasks.map((item) => item.id)).toEqual(["named"]);
  expect(columns[3]?.tasks.map((item) => item.id)).toEqual(["finished"]);
});

it("leaves a card where it is when the index and section already match", () => {
  const card = task({ id: "a", sectionId: "alpha" });
  expect(boardDrop(card, "alpha", "b", ["a", "b"])).toEqual({ kind: "none" });
  expect(boardDrop(card, "alpha", "a", ["a", "b"])).toEqual({ kind: "none" });
});

it("writes the section when a null card stays at the same index", () => {
  const card = task({ id: "a", sectionId: null });
  expect(boardDrop(card, "alpha", "b", ["a", "b"])).toEqual({ kind: "move", sectionId: "alpha", orderedIds: null });
});

it("inserts before the card under the pointer and appends on the column", () => {
  const card = task({ id: "c", sectionId: "alpha" });
  expect(boardDrop(card, "alpha", "a", ["a", "b", "c"])).toEqual({
    kind: "move",
    sectionId: "alpha",
    orderedIds: ["c", "a", "b"],
  });
  expect(boardDrop(card, "zebra", null, ["a", "b"])).toEqual({
    kind: "move",
    sectionId: "zebra",
    orderedIds: ["a", "b", "c"],
  });
});

it("completes an open drop on Done and only reorders a card that is already done", () => {
  const open = task({ id: "c", sectionId: "alpha", completedAt: null });
  expect(boardDrop(open, "done", "d1", ["d1", "d2"])).toEqual({ kind: "complete", orderedIds: ["c", "d1", "d2"] });
  const done = task({ id: "d2", sectionId: "alpha", completedAt: "2026-10-08T01:00:00.000Z" });
  expect(boardDrop(done, "done", "d1", ["d1", "d2"])).toEqual({ kind: "reorder-done", orderedIds: ["d2", "d1"] });
  expect(boardDrop(done, "done", null, ["d1", "d2"])).toEqual({ kind: "none" });
});

it("reopens a completed card onto the destination section", () => {
  const done = task({ id: "d", sectionId: "alpha", completedAt: "2026-10-08T01:00:00.000Z" });
  expect(boardDrop(done, "zebra", "b", ["a", "b"])).toEqual({
    kind: "reopen",
    sectionId: "zebra",
    orderedIds: ["a", "d", "b"],
  });
});

it("picks the first tag name by localeCompare", () => {
  const tags = tagsOnCard(
    "t1",
    [
      { taskId: "t1", tagId: "work" },
      { taskId: "t1", tagId: "home" },
      { taskId: "other", tagId: "home" },
    ],
    [
      { id: "work", name: "Work", color: "#111111" },
      { id: "home", name: "Home", color: "#222222" },
    ],
  );
  expect(tags.map((tag) => tag.name)).toEqual(["Home", "Work"]);
});
