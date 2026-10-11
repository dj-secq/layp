import { STICKERS, cleanListName, listSchema, sectionSchema, type Section, type TaskList } from "@layp/shared";
import { randomUUID } from "../link/random";
import { compareSections, sectionDeletePlan } from "./board";
import { withLock, withStamp } from "./lock";
import type { Run, SqlStatement } from "./sql";

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

export function loadSections(): Promise<Section[]> {
  return withLock(readSections);
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

export type Folder = { id: string; name: string; sortOrder: number; updatedAt: string };
export type ListSave<T> = { status: "saved"; row: T } | { status: "conflict"; current: T | null } | { status: "error"; message: string };

const LIST_ROW = `id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at`;

function parseLists(rows: Record<string, unknown>[]): TaskList[] {
  return rows.map((row) => listSchema.parse(row));
}

export function loadFolders(): Promise<Folder[]> {
  return withLock(async (run) => {
    const loaded = await run([{ sql: `SELECT id, name, sort_order, updated_at FROM folders ORDER BY sort_order ASC, name ASC`, values: [] }]);
    return (loaded.batches[0]?.rows ?? []).flatMap((row) =>
      typeof row.id === "string" && typeof row.name === "string" && typeof row.updated_at === "string"
        ? [{ id: row.id, name: row.name, sortOrder: Number(row.sort_order), updatedAt: row.updated_at }]
        : [],
    );
  });
}

export function loadArchivedLists(): Promise<TaskList[]> {
  return withLock(async (run) => {
    const loaded = await run([
      {
        sql: `SELECT ${LIST_ROW} FROM lists WHERE archived_at IS NOT NULL ORDER BY name ASC`,
        values: [],
      },
    ]);
    return parseLists(loaded.batches[0]?.rows ?? []);
  });
}

export async function createList(nameInput: string, color: string): Promise<ListSave<TaskList>> {
  try {
    return await withStamp((stamp, run) => createListOn(run, nameInput, color, stamp, randomUUID(), randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function createListOn(
  run: Run,
  nameInput: string,
  color: string,
  stamp: string,
  id: string,
  sectionId: string,
): Promise<ListSave<TaskList>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const hex = color.toLowerCase();
  if (!STICKERS.some((sticker) => sticker.hex === hex)) return { status: "error", message: "Pick a list color." };
  const max = await run([{ sql: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM lists`, values: [] }]);
  const sortOrder = Number(max.batches[0]?.rows[0]?.max_sort ?? 0) + 1;
  await run([
    {
      sql: `INSERT INTO lists (id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at)
            VALUES ($1, NULL, $2, $3, $4, NULL, 0, $5, $5)`,
      values: [id, cleaned.name, hex, sortOrder, stamp],
    },
    {
      sql: `INSERT INTO sections (id, list_id, name, sort_order, updated_at) VALUES ($1, $2, 'Open', 0, $3)`,
      values: [sectionId, id, stamp],
    },
  ]);
  return {
    status: "saved",
    row: {
      id,
      folderId: null,
      name: cleaned.name,
      color: hex,
      sortOrder,
      archivedAt: null,
      isInbox: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}

export async function renameList(list: TaskList, nameInput: string): Promise<ListSave<TaskList>> {
  if (list.isInbox || list.id === "inbox") return { status: "error", message: "Inbox stays Inbox." };
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        {
          sql: `UPDATE lists SET name = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4 AND is_inbox = 0`,
          values: [cleaned.name, stamp, list.id, list.updatedAt],
        },
      ]);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0) return { status: "conflict" as const, current: list };
      return { status: "saved" as const, row: { ...list, name: cleaned.name, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function recolorList(list: TaskList, color: string): Promise<ListSave<TaskList>> {
  const hex = color.toLowerCase();
  if (!STICKERS.some((sticker) => sticker.hex === hex)) return { status: "error", message: "Pick a list color." };
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        {
          sql: `UPDATE lists SET color = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4`,
          values: [hex, stamp, list.id, list.updatedAt],
        },
      ]);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0) return { status: "conflict" as const, current: list };
      return { status: "saved" as const, row: { ...list, color: hex, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function archiveList(list: TaskList): Promise<ListSave<TaskList>> {
  if (list.isInbox) return { status: "error", message: "Inbox stays in the sidebar." };
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        {
          sql: `UPDATE lists SET archived_at = $1, updated_at = $1 WHERE id = $2 AND is_inbox = 0 AND archived_at IS NULL`,
          values: [stamp, list.id],
        },
      ]);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0) return { status: "error" as const, message: "Not saved" };
      return { status: "saved" as const, row: { ...list, archivedAt: stamp, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function restoreList(list: TaskList): Promise<ListSave<TaskList>> {
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        { sql: `UPDATE lists SET archived_at = NULL, updated_at = $1 WHERE id = $2`, values: [stamp, list.id] },
      ]);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0) return { status: "error" as const, message: "Not saved" };
      return { status: "saved" as const, row: { ...list, archivedAt: null, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function purgeList(list: TaskList): Promise<ListSave<{ id: string }>> {
  if (list.isInbox) return { status: "error", message: "Inbox stays in the sidebar." };
  try {
    const saved = await withStamp(async (stamp, run) => {
      const rows = await run([
        { sql: `SELECT id FROM lists WHERE id = $1 AND is_inbox = 0 AND archived_at IS NOT NULL`, values: [list.id] },
      ]);
      if ((rows.batches[0]?.rows.length ?? 0) === 0) return false;
      const tasks = await run([{ sql: `SELECT id FROM tasks WHERE list_id = $1`, values: [list.id] }]);
      const statements: SqlStatement[] = (tasks.batches[0]?.rows ?? []).flatMap((row) =>
        typeof row.id === "string"
          ? [{
              sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
              values: [randomUUID(), "tasks", row.id, stamp],
            }]
          : [],
      );
      statements.push(
        {
          sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), "lists", list.id, stamp],
        },
        { sql: `DELETE FROM tasks WHERE list_id = $1 AND parent_id IS NOT NULL`, values: [list.id] },
        { sql: `DELETE FROM tasks WHERE list_id = $1`, values: [list.id] },
        { sql: `DELETE FROM lists WHERE id = $1 AND is_inbox = 0 AND archived_at IS NOT NULL`, values: [list.id] },
      );
      await run(statements);
      return true;
    });
    if (!saved) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id: list.id } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function createFolder(nameInput: string): Promise<ListSave<Folder>> {
  try {
    return await withStamp((stamp, run) => createFolderOn(run, nameInput, stamp, randomUUID()));
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function createFolderOn(run: Run, nameInput: string, stamp: string, id: string): Promise<ListSave<Folder>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const max = await run([{ sql: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM folders`, values: [] }]);
  const sortOrder = Number(max.batches[0]?.rows[0]?.max_sort ?? 0) + 1;
  await run([
    {
      sql: `INSERT INTO folders (id, name, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
      values: [id, cleaned.name, sortOrder, stamp],
    },
  ]);
  return { status: "saved", row: { id, name: cleaned.name, sortOrder, updatedAt: stamp } };
}

export async function renameFolder(folder: Folder, nameInput: string): Promise<ListSave<Folder>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        { sql: `UPDATE folders SET name = $1, updated_at = $2 WHERE id = $3`, values: [cleaned.name, stamp, folder.id] },
      ]);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0) return { status: "error" as const, message: "Not saved" };
      return { status: "saved" as const, row: { ...folder, name: cleaned.name, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function deleteFolder(folderId: string): Promise<ListSave<{ id: string }>> {
  try {
    const saved = await withStamp(async (stamp, run) => {
      const existing = await run([{ sql: `SELECT id FROM folders WHERE id = $1`, values: [folderId] }]);
      if ((existing.batches[0]?.rows.length ?? 0) === 0) return false;
      await run([
        { sql: `UPDATE lists SET folder_id = NULL, updated_at = $1 WHERE folder_id = $2`, values: [stamp, folderId] },
        {
          sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), "folders", folderId, stamp],
        },
        { sql: `DELETE FROM folders WHERE id = $1`, values: [folderId] },
      ]);
      return true;
    });
    if (!saved) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id: folderId } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function assignFolder(list: TaskList, folderId: string | null): Promise<ListSave<TaskList>> {
  try {
    return await withStamp(async (stamp, run) => {
      const saved = await run([
        { sql: `UPDATE lists SET folder_id = $1, updated_at = $2 WHERE id = $3`, values: [folderId, stamp, list.id] },
      ]);
      if ((saved.batches[0]?.rowsAffected ?? 0) === 0) return { status: "error" as const, message: "Not saved" };
      return { status: "saved" as const, row: { ...list, folderId, updatedAt: stamp } };
    });
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function reorderLists(ids: string[]): Promise<"saved" | "error"> {
  if (ids.length === 0) return "saved";
  try {
    await withStamp((stamp, run) =>
      run(ids.map((id, index) => ({ sql: `UPDATE lists SET sort_order = $1, updated_at = $2 WHERE id = $3`, values: [index, stamp, id] }))),
    );
    return "saved";
  } catch {
    return "error";
  }
}

export async function reorderFolders(ids: string[]): Promise<"saved" | "error"> {
  if (ids.length === 0) return "saved";
  try {
    await withStamp((stamp, run) =>
      run(ids.map((id, index) => ({ sql: `UPDATE folders SET sort_order = $1, updated_at = $2 WHERE id = $3`, values: [index, stamp, id] }))),
    );
    return "saved";
  } catch {
    return "error";
  }
}
