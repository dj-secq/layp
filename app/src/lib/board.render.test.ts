import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Task } from "../db/types";
import { formatShortDay } from "@layp/shared";
import { BoardCard, BoardColumn, BoardNewSection, type BoardColumnModel } from "../screens/BoardScreen";

vi.mock("../state/AppState", () => ({
  useApp: () => ({
    setOpenTaskId: () => undefined,
    refreshLists: async () => undefined,
    bump: () => undefined,
  }),
}));

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

const alpha = { id: "alpha", listId: "list", name: "Alpha", sortOrder: 0, updatedAt: "2026-10-08T00:00:00.000Z" };
const beta = { id: "beta", listId: "list", name: "Beta", sortOrder: 1, updatedAt: "2026-10-08T00:00:00.000Z" };

function column(model: BoardColumnModel, sections: (typeof alpha)[]) {
  return renderToStaticMarkup(
    createElement(BoardColumn, {
      column: model,
      sections,
      listColor: "#336699",
      clock: "12",
      tagsFor: () => [],
      onDrop: () => undefined,
    }),
  );
}

it("shows priority, due date, checklist progress, and one tag on the card", () => {
  const rich = renderToStaticMarkup(
    createElement(BoardCard, {
      task: task({
        title: "Pack",
        priority: "high",
        dueOn: "2026-12-25",
        dueTime: "15:00",
        notes: "[ ] Socks\n[x] Tickets",
      }),
      listColor: "#336699",
      clock: "12",
      tags: [
        { name: "Home", color: "#222222" },
        { name: "Work", color: "#111111" },
      ],
      onOpen: () => undefined,
      onDrop: () => undefined,
    }),
  );
  expect(rich).toContain("Pack");
  expect(rich).toContain("title=\"high\"");
  expect(rich).toContain("var(--danger)");
  expect(rich).toContain(formatShortDay("2026-12-25"));
  expect(rich).toContain("3:00 PM");
  expect(rich).toContain("1/2");
  expect(rich).toContain("Home");
  expect(rich).toContain("+1");
  expect(rich).not.toContain("Work");

  const plain = renderToStaticMarkup(
    createElement(BoardCard, {
      task: task({ title: "Milk" }),
      listColor: "#336699",
      clock: "24",
      tags: [],
      onOpen: () => undefined,
      onDrop: () => undefined,
    }),
  );
  expect(plain).toContain("Milk");
  expect(plain).not.toContain("1/2");
  expect(plain).not.toContain("title=\"high\"");
  expect(plain).not.toContain("+");
});

it("gives a real column rename, up, down, and delete, and leaves Done bare", () => {
  const two = column({ id: "alpha", name: "Alpha", tasks: [] }, [alpha, beta]);
  expect(two).toContain('aria-label="Move Alpha up" aria-disabled="true" disabled=""');
  expect(two).toContain('aria-label="Move Alpha down"');
  expect(two).toContain('aria-label="Rename Alpha"');
  expect(two).toContain('aria-label="Delete Alpha"');
  expect(two).not.toContain('aria-label="Delete Alpha" aria-disabled="true"');

  const only = column({ id: "alpha", name: "Alpha", tasks: [] }, [alpha]);
  expect(only).toContain('aria-label="Delete Alpha" aria-disabled="true" disabled=""');

  const done = column({ id: "done", name: "Done", tasks: [] }, [alpha, beta]);
  expect(done).toContain("Done");
  expect(done).not.toContain("Rename");
  expect(done).not.toContain("Delete");
  expect(done).not.toContain("Move Done");
});

it("offers the list's add-section field before Done", () => {
  const html = renderToStaticMarkup(
    createElement(BoardNewSection, { name: "", onName: () => undefined, onAdd: () => undefined }),
  );
  expect(html).toContain("New section");
  expect(html).toContain("Add section");
});
