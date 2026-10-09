import { cleanListName, listSchema, sectionSchema, type Section, type TaskList } from "@layp/shared";
import { randomUUID } from "../link/random";
import { compareSections, sectionDeletePlan } from "./board";
import { withLock, withStamp } from "./lock";
import type { Run } from "./sql";

export { compareSections };

export type SectionResult<T> = { status: "saved"; row: T } | { status: "error"; message: string };

const LIST_SQL = `SELECT id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at
  FROM lists
  WHERE archived_at IS NULL
  ORDER BY sort_order ASC, name ASC`;

const SECTION_SQL = `SELECT id, list_id, name, sort_order, updated_at FROM sections ORDER BY sort_order ASC, name ASC`;

export async function readLists(run: Run): Promise<TaskList[]> {
  const loaded = await run([{ sql: LIST_SQL, values: [] }]);
  return (loaded.batches[0]?.rows ?? []).map((row) => listSchema.parse(row));
}

export async function readSections(run: Run): Promise<Section[]> {
  const loaded = await run([{ sql: SECTION_SQL, values: [] }]);
  return (loaded.batches[0]?.rows ?? []).map((row) => sectionSchema.parse(row));
}

export function loadLists(): Promise<TaskList[]> {
  return withLock(readLists);
}

export function firstSectionId(sections: Pick<Section, "id" | "listId" | "sortOrder" | "name">[], listId: string): string | null {
  const match = sections.filter((section) => section.listId === listId).sort(compareSections);
  return match[0]?.id ?? null;
}

export function inboxList(lists: TaskList[]): TaskList | null {
  return lists.find((list) => list.isInbox) ?? null;
}

export async function createSection(listId: string, nameInput: string): Promise<SectionResult<Section>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    return await withStamp((stamp, run) => createSectionOn(run, listId, cleaned.name, stamp, randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function renameSection(section: Section, nameInput: string): Promise<SectionResult<Section>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    return await withStamp((stamp, run) => renameSectionOn(run, section, cleaned.name, stamp));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function deleteSection(sectionId: string, listId: string): Promise<SectionResult<{ id: string }>> {
  try {
    return await withStamp((stamp, run) => deleteSectionOn(run, sectionId, listId, stamp, () => randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function reorderSections(ids: string[]): Promise<"saved" | "error"> {
  if (ids.length === 0) return "saved";
  try {
    await withStamp((stamp, run) => reorderSectionsOn(run, ids, stamp));
    return "saved";
  } catch {
    return "error";
  }
}

export async function createSectionOn(run: Run, listId: string, nameInput: string, stamp: string, id: string): Promise<SectionResult<Section>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const max = await run([
    { sql: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM sections WHERE list_id = $1`, values: [listId] },
  ]);
  const sortOrder = Number(max.batches[0]?.rows[0]?.max_sort ?? 0) + 1;
  await run([
    {
      sql: `INSERT INTO sections (id, list_id, name, sort_order, updated_at) VALUES ($1, $2, $3, $4, $5)`,
      values: [id, listId, cleaned.name, sortOrder, stamp],
    },
  ]);
  return { status: "saved", row: { id, listId, name: cleaned.name, sortOrder, updatedAt: stamp } };
}

export async function renameSectionOn(run: Run, section: Section, nameInput: string, stamp: string): Promise<SectionResult<Section>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const saved = await run([
    {
      sql: `UPDATE sections SET name = $1, updated_at = $2 WHERE id = $3 AND list_id = $4`,
      values: [cleaned.name, stamp, section.id, section.listId],
    },
  ]);
  if ((saved.batches[0]?.rowsAffected ?? 0) === 0) return { status: "error", message: "Not saved" };
  return { status: "saved", row: { ...section, name: cleaned.name, updatedAt: stamp } };
}

/** Move every task on this section, including completed and trashed rows, then delete it. */
export async function deleteSectionOn(
  run: Run,
  sectionId: string,
  listId: string,
  stamp: string,
  newId: () => string,
): Promise<SectionResult<{ id: string }>> {
  const sections = (await readSections(run)).filter((section) => section.listId === listId);
  if (!sections.some((section) => section.id === sectionId)) return { status: "error", message: "Not saved" };
  const plan = sectionDeletePlan(sections, sectionId);
  if ("error" in plan) return { status: "error", message: plan.error };
  await run([
    {
      sql: `UPDATE tasks SET section_id = $1, updated_at = $2 WHERE section_id = $3`,
      values: [plan.targetId, stamp, sectionId],
    },
    {
      sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
      values: [newId(), "sections", sectionId, stamp],
    },
    { sql: `DELETE FROM sections WHERE id = $1 AND list_id = $2`, values: [sectionId, listId] },
  ]);
  return { status: "saved", row: { id: sectionId } };
}

export async function reorderSectionsOn(run: Run, ids: string[], stamp: string): Promise<void> {
  if (ids.length === 0) return;
  await run(
    ids.map((id, index) => ({
      sql: `UPDATE sections SET sort_order = $1, updated_at = $2 WHERE id = $3`,
      values: [index, stamp, id],
    })),
  );
}
