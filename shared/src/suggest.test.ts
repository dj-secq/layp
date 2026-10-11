import { describe, expect, it } from "vitest";
import { parseQuickAdd, type QuickList } from "./parse";
import { previewQuickAdd, suggestQuickAdd, type SuggestContext } from "./suggest";
import type { QuickSnippet } from "./snippets";

const lists: QuickList[] = [
  { id: "inbox", name: "Inbox" },
  { id: "school", name: "School" },
];

const sunday = { today: "2026-10-04", minutes: 15 * 60 };

const gym: QuickSnippet = { id: "gym", name: "gym", line: "gym friday 6pm every week" };

function context(patch: Partial<SuggestContext> = {}): SuggestContext {
  return {
    lists,
    recentTitles: ["buy milk", "gym"],
    snippets: [gym],
    ...patch,
  };
}

describe("previewQuickAdd", () => {
  it("summarizes the parsed line", () => {
    expect(previewQuickAdd("gym friday 6pm every week in School", lists, sunday, "12")).toBe(
      "gym · Fri, Oct 9 · 6:00 PM · Every week · School",
    );
  });

  it("shows an unknown list", () => {
    expect(previewQuickAdd("essay in Shop", lists, sunday, "12")).toBe("No list named Shop.");
  });

  it("asks for a title when the line is only a date", () => {
    expect(previewQuickAdd("tomorrow", lists, sunday, "12")).toBe("Add a title.");
  });

  it("stays quiet on an empty line", () => {
    expect(previewQuickAdd("   ", lists, sunday, "12")).toBeNull();
  });
});

describe("suggestQuickAdd", () => {
  it("offers snippets and then the starters on an empty line", () => {
    const rows = suggestQuickAdd("", context(), sunday);
    expect(rows.map((row) => row.label)).toEqual(["gym", "tomorrow", "tonight", "friday 6pm", "every weekday"]);
    expect(rows[0]?.next).toBe("gym friday 6pm every week");
  });

  it("filters snippets after a slash and does not save", () => {
    const rows = suggestQuickAdd("/gy", context(), sunday);
    expect(rows).toEqual([
      { id: "snippet:gym", label: "gym", detail: "gym friday 6pm every week", next: "gym friday 6pm every week" },
    ]);
  });

  it("prefers a snippet over a title with the same name", () => {
    const rows = suggestQuickAdd("gym", context(), sunday);
    expect(rows.map((row) => row.id)).toEqual(["snippet:gym"]);
  });

  it("inserts a list name after in", () => {
    const rows = suggestQuickAdd("essay in sch", context({ snippets: [] }), sunday);
    expect(rows[0]).toMatchObject({ label: "School", next: "essay in School" });
  });

  it("offers days and weeks after a number", () => {
    const rows = suggestQuickAdd("call mom in 3", context({ snippets: [] }), sunday);
    expect(rows.map((row) => row.label).slice(0, 2)).toEqual(["3 days", "3 weeks"]);
    expect(rows[0]?.next).toBe("call mom in 3 days");
  });

  it("completes the current date word", () => {
    const rows = suggestQuickAdd("gym fri", context({ snippets: [] }), sunday);
    expect(rows.map((row) => row.label)).toContain("friday");
    expect(rows.find((row) => row.label === "friday")?.next).toBe("gym friday");
  });

  it("suggests recent titles only when the line has no token", () => {
    const open = suggestQuickAdd("buy", context({ snippets: [] }), sunday);
    expect(open.map((row) => row.next)).toEqual(["buy milk"]);
    expect(suggestQuickAdd("buy milk tomorrow", context({ snippets: [] }), sunday)).toEqual([]);
  });

  it("returns at most six rows", () => {
    const snippets = Array.from({ length: 10 }, (_, index) => ({
      id: `s${index}`,
      name: `name ${index}`,
      line: `task ${index}`,
    }));
    expect(suggestQuickAdd("", context({ snippets }), sunday)).toHaveLength(6);
  });
});

describe("in N days", () => {
  it("reads a day span instead of a list name", () => {
    expect(parseQuickAdd("call mom in 3 days", lists, sunday)).toMatchObject({
      status: "ok",
      title: "call mom",
      dueOn: "2026-10-07",
      listId: null,
      notice: null,
    });
  });

  it("reads weeks and a list on the same line", () => {
    expect(parseQuickAdd("call mom in 2 weeks in School", lists, sunday)).toMatchObject({
      title: "call mom",
      dueOn: "2026-10-18",
      listId: "school",
    });
  });
});
