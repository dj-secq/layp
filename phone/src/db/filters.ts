import { cleanListName, emptyRule, type FilterRule } from "@layp/shared";
import { z } from "zod";
import { randomUUID } from "../link/random";
import { withLock, withStamp } from "./lock";
import type { Run, SqlStatement } from "./sql";

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
    priority: rule.priority ?? null,
    due: rule.due ?? "any",
    dueFrom: rule.dueFrom ?? null,
    dueTo: rule.dueTo ?? null,
    completed: rule.completed ?? "open",
    important: rule.important ?? null,
    urgent: rule.urgent ?? null,
  }));

export type SavedFilter = { id: string; name: string; rule: FilterRule; sortOrder: number };
export type FilterSave<T> = { status: "saved"; row: T } | { status: "error"; message: string };

export function parseRule(json: string): FilterRule {
  try {
    return ruleSchema.parse(JSON.parse(json));
  } catch {
    return emptyRule();
  }
}

function deletion(entity: string, entityId: string, stamp: string): SqlStatement {
  return {
    sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
    values: [randomUUID(), entity, entityId, stamp],
  };
}

export function loadFilters(): Promise<SavedFilter[]> {
  return withLock(async (run) => {
    const loaded = await run([
      { sql: `SELECT id, name, rule_json, sort_order FROM filters ORDER BY sort_order ASC, name ASC`, values: [] },
    ]);
    return (loaded.batches[0]?.rows ?? []).flatMap((row) => {
      if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.rule_json !== "string") return [];
      return [{ id: row.id, name: row.name, rule: parseRule(row.rule_json), sortOrder: Number(row.sort_order) }];
    });
  });
}

export async function createFilter(nameInput: string, rule: FilterRule): Promise<FilterSave<SavedFilter>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    return await withStamp(async (stamp, run) => {
      const max = await run([{ sql: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM filters`, values: [] }]);
      const sortOrder = Number(max.batches[0]?.rows[0]?.max_sort ?? 0) + 1;
      const id = randomUUID();
      await run([
        {
          sql: `INSERT INTO filters (id, name, rule_json, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
          values: [id, cleaned.name, JSON.stringify(rule), sortOrder, stamp],
        },
      ]);
      return { status: "saved" as const, row: { id, name: cleaned.name, rule, sortOrder } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function updateFilter(filter: SavedFilter, nameInput: string, rule: FilterRule): Promise<FilterSave<SavedFilter>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    const saved = await withStamp(async (stamp, run) => {
      const result = await run([
        {
          sql: `UPDATE filters SET name = $1, rule_json = $2, updated_at = $3 WHERE id = $4`,
          values: [cleaned.name, JSON.stringify(rule), stamp, filter.id],
        },
      ]);
      return result.batches[0]?.rowsAffected ?? 0;
    });
    if (saved === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...filter, name: cleaned.name, rule } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function reorderFilters(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withStamp(async (stamp, run) => {
    await run(
      ids.map((id, index) => ({
        sql: `UPDATE filters SET sort_order = $1, updated_at = $2 WHERE id = $3`,
        values: [index, stamp, id],
      })),
    );
  });
}

export async function deleteFilter(id: string): Promise<FilterSave<{ id: string }>> {
  try {
    const saved = await withStamp(async (stamp, run) => {
      const rows = await run([{ sql: `SELECT id FROM filters WHERE id = $1`, values: [id] }]);
      if ((rows.batches[0]?.rows.length ?? 0) === 0) return false;
      await run([deletion("filters", id, stamp), { sql: `DELETE FROM filters WHERE id = $1`, values: [id] }]);
      return true;
    });
    if (!saved) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}
