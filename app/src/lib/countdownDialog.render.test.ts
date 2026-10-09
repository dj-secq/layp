import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CountdownDialog } from "../components/Sidebar";

vi.mock("../state/AppState", () => ({
  useApp: () => ({
    civilToday: "2026-10-08",
    bump: () => undefined,
  }),
}));

vi.mock("../components/Dialog", async () => {
  const { createElement: h } = await import("react");
  return {
    Dialog: ({ title, children }: { title: string; children: ReactNode }) =>
      h("section", null, h("h2", null, title), children),
  };
});

it("opens the countdown dialog on the current title and date", () => {
  const created = renderToStaticMarkup(createElement(CountdownDialog, { initial: null, onClose: () => undefined }));
  expect(created).toContain("Add countdown");
  expect(created).toContain('value="2026-10-08"');
  expect(created).not.toContain("Edit countdown");

  const edited = renderToStaticMarkup(
    createElement(CountdownDialog, {
      initial: {
        id: "count-1",
        title: "Trip",
        targetOn: "2026-12-25",
        sortOrder: 1,
        createdAt: "2026-10-08T00:00:00.000Z",
        updatedAt: "2026-10-08T00:00:00.000Z",
      },
      onClose: () => undefined,
    }),
  );
  expect(edited).toContain("Edit countdown");
  expect(edited).toContain('value="Trip"');
  expect(edited).toContain('value="2026-12-25"');
  expect(edited).not.toContain("Add countdown");
});
