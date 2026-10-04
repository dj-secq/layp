import { describe, expect, it } from "vitest";
import { checklistReminderBlock, checklistReminderCopies, reconcileChecklistReminders } from "./checklistReminders";

const milk = { id: "m", lineText: "milk" };

describe("checklist reminders", () => {
  it("renames a reminder when that one line changes", () => {
    const plan = reconcileChecklistReminders("[ ] milk\n[ ] eggs", "[ ] oat milk\n[ ] eggs", [milk]);
    expect(plan).toEqual({ updates: [{ id: "m", lineText: "oat milk" }], removeIds: [] });
  });

  it("drops a reminder when its line is deleted", () => {
    const plan = reconcileChecklistReminders("[ ] milk\n[ ] eggs", "[ ] eggs", [milk]);
    expect(plan.removeIds).toEqual(["m"]);
    expect(plan.updates).toEqual([]);
  });

  it("keeps a reminder when a different line changes and the text remains", () => {
    const plan = reconcileChecklistReminders("[ ] milk\n[ ] eggs", "[ ] milk\n[ ] bread", [milk]);
    expect(plan).toEqual({ updates: [], removeIds: [] });
  });

  it("refuses a second reminder on duplicate text and stops at 10", () => {
    const notes = "[ ] milk\n[ ] milk";
    expect(checklistReminderBlock(notes, "milk", [])).toBe("These lines need different text.");
    expect(checklistReminderBlock("[ ] milk", "milk", [milk])).toBe("That reminder is already set.");
    const ten = Array.from({ length: 10 }, (_, index) => ({ id: String(index), lineText: `row ${index}` }));
    expect(checklistReminderBlock("[ ] fresh", "fresh", ten)).toBe("A checklist can have 10 reminders.");
    expect(checklistReminderBlock("[ ] ", "", [])).toBe("Add text to the checklist line first.");
    expect(checklistReminderBlock("[ ] row 0", "row 0", ten.slice(1), true)).toBeNull();
  });

  it("copies a reminder onto the next occurrence with fired_at clear", () => {
    expect(
      checklistReminderCopies([{ lineText: "milk", dueOn: "2026-10-04", dueTime: null, minutesBefore: 15 }]),
    ).toEqual([{ lineText: "milk", dueOn: "2026-10-04", dueTime: null, minutesBefore: 15, firedAt: null }]);
  });
});