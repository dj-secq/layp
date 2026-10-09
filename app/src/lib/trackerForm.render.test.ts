import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Tracker } from "../db/trackers";
import { HobbyFields } from "../screens/HobbiesScreen";
import { TrackerForm } from "../screens/TrackersScreen";
import { DEFAULT_LIST_COLOR } from "@layp/shared";

vi.mock("../state/AppState", () => ({
  useApp: () => ({ bump: () => undefined }),
}));

const initial = {
  name: "Water",
  kind: "number" as const,
  unit: "glasses",
  target: "8",
  schedule: { type: "weekdays" as const, days: [1, 3] },
  color: DEFAULT_LIST_COLOR,
};

function trackerHtml(kindLocked: boolean) {
  return renderToStaticMarkup(
    createElement(TrackerForm, {
      initial,
      kindLocked,
      submitLabel: "Save",
      onSubmit: async () => ({ status: "saved" as const, row: {} as Tracker }),
      onError: () => undefined,
    }),
  );
}

it("edits the same tracker fields and freezes kind after a log", () => {
  const open = trackerHtml(false);
  expect(open).toContain("Water");
  expect(open).toContain("Kind");
  expect(open).toContain("Unit");
  expect(open).toContain("glasses");
  expect(open).toContain("Target");
  expect(open).toContain("Schedule");
  expect(open).toContain("Mon");
  expect(open).toContain("Save");
  expect(open).not.toContain("Kind stays after the first log.");
  expect(open).not.toContain('disabled=""');

  const locked = trackerHtml(true);
  expect(locked).toContain("Kind stays after the first log.");
  expect(locked).toContain('disabled=""');
  expect(locked).toContain("Schedule");
});

it("edits a hobby name and color without kind, unit, target, or schedule", () => {
  const hobby: Tracker = {
    id: "hobby",
    name: "Piano",
    kind: "minutes",
    unit: null,
    dailyTarget: null,
    color: DEFAULT_LIST_COLOR,
    isHobby: true,
    schedule: { type: "daily" },
    sortOrder: 0,
    archivedAt: null,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
  };
  const html = renderToStaticMarkup(createElement(HobbyFields, { hobby }));
  expect(html).toContain("Piano");
  expect(html).toContain("Name");
  expect(html).toContain("Save");
  expect(html).toContain("yellow");
  expect(html).not.toContain("Kind");
  expect(html).not.toContain("Unit");
  expect(html).not.toContain("Target");
  expect(html).not.toContain("Schedule");
});
