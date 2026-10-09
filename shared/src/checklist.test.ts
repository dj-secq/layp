import { describe, expect, it } from "vitest";
import { checklistLines, toggleChecklistLine } from "./checklist";

describe("checklist lines", () => {
  it("renders only exact [ ] and [x] lines and toggles that line", () => {
    const notes = "plain\n[ ] buy milk\n[x] eggs\n[X] not a box";
    expect(checklistLines(notes)).toEqual([
      { index: 1, done: false, text: "buy milk" },
      { index: 2, done: true, text: "eggs" },
    ]);
    expect(toggleChecklistLine(notes, 1)).toBe("plain\n[x] buy milk\n[x] eggs\n[X] not a box");
    expect(toggleChecklistLine(notes, 2)).toBe("plain\n[ ] buy milk\n[ ] eggs\n[X] not a box");
    expect(toggleChecklistLine(notes, 0)).toBe(notes);
  });
});
