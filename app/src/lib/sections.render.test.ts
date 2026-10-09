import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SectionBlock } from "../screens/ListScreen";

vi.mock("../state/AppState", () => ({
  useApp: () => ({}),
}));

const alpha = { id: "a", listId: "list", name: "Alpha", sortOrder: 0, updatedAt: "" };
const beta = { id: "b", listId: "list", name: "Beta", sortOrder: 1, updatedAt: "" };

function html(sections: (typeof alpha)[], section = sections[0]) {
  return renderToStaticMarkup(
    createElement(SectionBlock, {
      section,
      sections,
      tasks: [],
      enteredId: null,
      sortMode: "manual",
      onToggle: async () => undefined,
      onMove: () => undefined,
    }),
  );
}

it("gives every section up, down, rename, and delete, and keeps the last section", () => {
  const two = html([alpha, beta]);
  expect(two).toContain("Alpha");
  expect(two).toContain('aria-label="Move Alpha up"');
  expect(two).toContain('aria-label="Move Alpha down"');
  expect(two).toContain('aria-label="Rename Alpha"');
  expect(two).toContain('aria-label="Delete Alpha"');
  expect(two).toContain('aria-label="Move Alpha up" aria-disabled="true" disabled=""');
  expect(two).not.toContain('aria-label="Move Alpha down" aria-disabled="true"');
  expect(two).not.toContain("Move first section down");

  const only = html([alpha]);
  expect(only).toContain('aria-label="Delete Alpha" aria-disabled="true" disabled=""');

  const loose = html([], { id: "loose", listId: "list", name: "No section", sortOrder: 0, updatedAt: "" });
  expect(loose).toContain("No section");
  expect(loose).not.toContain("Rename");
  expect(loose).not.toContain("Delete");
});
