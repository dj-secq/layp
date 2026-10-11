import { describe, expect, it } from "vitest";
import { parseSnippets, snippetDraftError, snippetsJson, type QuickSnippet } from "./snippets";

const gym: QuickSnippet = { id: "1", name: "gym", line: "gym friday 6pm" };

describe("parseSnippets", () => {
  it("drops a bad value and a duplicate name", () => {
    expect(parseSnippets("nope")).toEqual([]);
    const raw = snippetsJson([gym, { id: "2", name: " Gym ", line: "other" }, { id: "3", name: "run", line: "run tomorrow" }]);
    expect(parseSnippets(raw)).toEqual([gym, { id: "3", name: "run", line: "run tomorrow" }]);
  });
});

describe("snippetDraftError", () => {
  it("allows an edit that keeps the same name", () => {
    expect(snippetDraftError([gym], "gym", "gym tonight", "1")).toBeNull();
  });

  it("rejects a second copy of the name and a 25th row", () => {
    expect(snippetDraftError([gym], "Gym", "gym tonight")).toBe("That name is already used.");
    const full = Array.from({ length: 24 }, (_, index) => ({ id: String(index), name: `n${index}`, line: "task" }));
    expect(snippetDraftError(full, "extra", "task")).toBe("24 snippets is the limit.");
  });
});
