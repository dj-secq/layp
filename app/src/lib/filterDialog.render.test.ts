import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FilterDialog } from "../components/Sidebar";
import { emptyRule } from "@layp/shared";

vi.mock("../state/AppState", () => ({
  useApp: () => ({
    lists: [] as { id: string; name: string }[],
    bump: () => undefined,
    goFilter: () => undefined,
  }),
}));

vi.mock("../components/Dialog", async () => {
  const { createElement: h } = await import("react");
  return {
    Dialog: ({ title, children }: { title: string; children: ReactNode }) =>
      h("section", null, h("h2", null, title), children),
  };
});

it("opens the filter dialog on the current rule", () => {
  const created = renderToStaticMarkup(createElement(FilterDialog, { initial: null, onClose: () => undefined }));
  expect(created).toContain("New filter");
  expect(created).toContain("Any priority");
  expect(created).not.toContain("Edit filter");

  const edited = renderToStaticMarkup(
    createElement(FilterDialog, {
      initial: {
        id: "filter-1",
        name: "Focus",
        sortOrder: 1,
        rule: { ...emptyRule(), priority: "high" },
      },
      onClose: () => undefined,
    }),
  );
  expect(edited).toContain("Edit filter");
  expect(edited).toContain('value="Focus"');
  expect(edited).toContain("High");
  expect(edited).not.toContain("Any priority");
});
