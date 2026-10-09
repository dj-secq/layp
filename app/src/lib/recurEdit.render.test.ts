import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RecurrenceEditor } from "../task-panel/RecurrenceEditor";
import { rule, serializeRule } from "@layp/shared";

const base = {
  id: "task-1",
  dueOn: "2026-10-05",
  dueTime: null as string | null,
  completedAt: null as string | null,
};

function html(task: { recurrenceJson: string | null; completedAt?: string | null }) {
  return renderToStaticMarkup(
    createElement(RecurrenceEditor, {
      task: { ...base, completedAt: task.completedAt ?? null, recurrenceJson: task.recurrenceJson },
      today: "2026-10-08",
      onSave: () => undefined,
    }),
  );
}

it("renders the repeat controls for a stored weekly rule and locks a completed one", () => {
  const none = html({ recurrenceJson: null });
  expect(none).toContain("Does not repeat.");
  expect(none).not.toContain("Interval");
  expect(none).not.toContain("Save repeat");

  const weekly = html({
    recurrenceJson: serializeRule(
      rule({
        freq: "weekly",
        interval: 2,
        byWeekday: ["MO", "FR"],
        basis: "completed",
        end: { type: "count", remaining: 3 },
      }),
    ),
  });
  expect(weekly).toContain("Every 2 weeks on Monday, Friday");
  expect(weekly).toContain("Interval");
  expect(weekly).toContain("Weekdays");
  expect(weekly).toContain("Mon");
  expect(weekly).toContain("Fri");
  expect(weekly).toContain('aria-pressed="true"');
  expect(weekly).toContain("From the day it is completed");
  expect(weekly).toContain("After a count");
  expect(weekly).toContain('value="3"');
  expect(weekly).toContain("Save repeat");

  const done = html({
    recurrenceJson: serializeRule(rule({ freq: "daily" })),
    completedAt: "2026-10-08T12:00:00.000Z",
  });
  expect(done).toContain("Every day");
  expect(done).toContain("On the scheduled date");
  expect(done).toContain("Save repeat");
  expect(done).toContain("disabled");
});
