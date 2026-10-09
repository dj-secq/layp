import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const tables = ["sections", "tags", "reminders", "checklist_reminders", "countdowns", "settings", "focus_sessions"];

function columnLists(source: string, table: string): string[] {
  const found: string[] = [];
  const re = new RegExp(`INSERT INTO ${table}\\s*\\(([\\s\\S]*?)\\)`, "gi");
  for (const match of source.matchAll(re)) found.push(match[1] ?? "");
  return found;
}

it("names updated_at on every insert into a table whose cursor column is new", () => {
  const sources = [
    "lists.ts",
    "reminders.ts",
    "tasks.ts",
    "checklistReminders.ts",
    "tags.ts",
    "countdowns.ts",
    "settings.ts",
    "focus.ts",
  ].map((name) => readFileSync(join(root, name), "utf8"));
  const joined = sources.join("\n");
  for (const table of tables) {
    const lists = columnLists(joined, table);
    expect(lists.length, table).toBeGreaterThan(0);
    for (const columns of lists) expect(columns, `${table}: ${columns}`).toMatch(/updated_at/);
  }
});
