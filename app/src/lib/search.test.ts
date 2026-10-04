import { describe, expect, it } from "vitest";
import { ftsMatch, likePattern } from "./search";

describe("likePattern", () => {
  it("escapes percent, underscore, and backslash", () => {
    expect(likePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});

describe("ftsMatch", () => {
  it("keeps one-character queries on the LIKE path", () => {
    expect(ftsMatch("a")).toBeNull();
    expect(ftsMatch("%")).toBeNull();
    expect(ftsMatch("_")).toBeNull();
    expect(ftsMatch('"')).toBeNull();
  });

  it("searches a phrase and a prefix on the last word", () => {
    expect(ftsMatch("milk eggs")).toBe('"milk eggs"*');
    expect(ftsMatch("milk e")).toBe('"milk e"');
  });

  it("keeps percent, underscore, and quotes literal", () => {
    expect(ftsMatch('100%_done')).toBe('"100%_done"*');
    expect(ftsMatch('say "hi" there')).toBe('"say hi there"*');
    expect(ftsMatch("***")).toBeNull();
    expect(likePattern("%")).toBe("%\\%%");
    expect(likePattern("_")).toBe("%\\_%");
    expect(likePattern('"')).toBe('%"%');
  });
});

