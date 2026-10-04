import { z } from "zod";
import { nowIso } from "../lib/clock";
import { emptyRule, type FilterRule } from "../lib/planner";
import { cleanListName } from "../lib/validate";
import { logFailure, query, run } from "./client";
import type { Priority, SaveResult } from "./types";

const priority = z.enum(["none", "low", "medium", "high"]).nullable();

const ruleSchema = z
  .object({
    listId: z.string().nullable().optional(),
    listNot: z.boolean().optional(),
    tagId: z.string().nullable().optional(),
    priority: priority.optional(),
    due: z.enum(["any", "overdue", "today", "next7", "none", "range"]).optional(),
    dueFrom: z.string().nullable().optional(),
    dueTo: z.string().nullable().optional(),
    completed: z.enum(["any", "open", "completed"]).optional(),
    important: z.boolean().nullable().optional(),
    urgent: z.boolean().nullable().optional(),
  })
  .transform((rule): FilterRule => ({
    ...emptyRule(),
    listId: rule.listId ?? null,
    listNot: rule.listNot ?? false,
    tagId: rule.tagId ?? null,
    priority: (rule.priority ?? null) as Priority | null,
    due: rule.due ?? "any",
    dueFrom: rule.dueFrom ?? null,
    dueTo: rule.dueTo ?? null,
    completed: rule.completed ?? "open",
    important: rule.important ?? null,
    urgent: rule.urgent ?? null,
  }));

export type SavedFilter = { id: string; name: string; rule: FilterRule; sortOrder: number };

export async function loadFilters(): Promise<SavedFilter[]> {
  const rows = await query<{ id: string; name: string; rule_json: string; sort_order: number | string }>(
    `SELECT id, name, rule_json, sort_order FROM filters ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    rule: parseRule(row.rule_json),
    sortOrder: Number(row.sort_order),
  }));
}

export function parseRule(json: string): FilterRule {
  try {
    return ruleSchema.parse(JSON.parse(json));
  } catch {
    return emptyRule();
  }
}

export async function createFilter(nameInput: string, rule: FilterRule): Promise<SaveResult<SavedFilter>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const id = crypto.randomUUID();
  const stamp = nowIso();
  try {
    const maxRows = await query<{ max_sort: number | null }>(`SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM filters`);
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    await run(
      `INSERT INTO filters (id, name, rule_json, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, cleaned.name, JSON.stringify(rule), sortOrder, stamp],
    );
    return { status: "saved", row: { id, name: cleaned.name, rule, sortOrder } };
  } catch {
    await logFailure("filter save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function deleteFilter(id: string): Promise<SaveResult<{ id: string }>> {
  try {
    const affected = await run(`DELETE FROM filters WHERE id = $1`, [id]);
    if (affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id } };
  } catch {
    await logFailure("filter save failed");
    return { status: "error", message: "Not saved" };
  }
}
