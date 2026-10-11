import { emptyRule } from "@layp/shared";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("filter tests do not open the phone database");
  },
}));

import { parseRule } from "./filters";

it("keeps a partial rule and falls back when the json is not a rule", () => {
  expect(parseRule(JSON.stringify({ listId: "inbox", completed: "any" }))).toEqual({
    ...emptyRule(),
    listId: "inbox",
    completed: "any",
  });
  expect(parseRule("not json")).toEqual(emptyRule());
});
