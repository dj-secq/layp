import { describe, expect, it } from "vitest";
import { sectionDeletePlan } from "./sections";

describe("sectionDeletePlan", () => {
  const sections = [
    { id: "second", name: "Beta", sortOrder: 2 },
    { id: "first", name: "Alpha", sortOrder: 1 },
    { id: "third", name: "Gamma", sortOrder: 3 },
  ];

  it("keeps the last section", () => {
    expect(sectionDeletePlan([{ id: "only", name: "Open", sortOrder: 0 }], "only")).toEqual({
      error: "Last section stays.",
    });
  });

  it("sends a deleted first section to the new first", () => {
    expect(sectionDeletePlan(sections, "first")).toEqual({ targetId: "second" });
  });

  it("keeps the first section when a middle one is deleted", () => {
    expect(sectionDeletePlan(sections, "second")).toEqual({ targetId: "first" });
  });

  it("picks the target with firstSectionId's comparator, sortOrder then name, not id order", () => {
    const tied = [
      { id: "id-z", name: "Zebra", sortOrder: 0 },
      { id: "id-a", name: "Alpha", sortOrder: 0 },
      { id: "id-m", name: "Middle", sortOrder: 1 },
    ];
    expect(sectionDeletePlan(tied, "id-m")).toEqual({ targetId: "id-a" });
  });
});
