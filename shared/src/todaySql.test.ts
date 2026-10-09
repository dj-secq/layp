import { expect, it } from "vitest";
import { TASKS_FOR_DATE_WHERE } from "./todaySql";

it("keeps the Today membership predicates", () => {
  expect(TASKS_FOR_DATE_WHERE).toContain("deleted_at IS NULL");
  expect(TASKS_FOR_DATE_WHERE).toContain("parent_id IS NULL");
  expect(TASKS_FOR_DATE_WHERE).toContain("archived_at IS NULL");
  expect(TASKS_FOR_DATE_WHERE).toContain("due_on = $1");
  expect(TASKS_FOR_DATE_WHERE).toContain("start_on = $1");
  expect(TASKS_FOR_DATE_WHERE).toContain("pinned = 1");
  expect(TASKS_FOR_DATE_WHERE).toContain("due_on < $2");
});
