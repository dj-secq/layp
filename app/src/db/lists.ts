import { DEFAULT_LIST_COLOR, STICKERS, cleanListName } from "@layp/shared";
import { compareSections, sectionDeletePlan } from "../lib/sections";
import { attachmentIdsForTasks, dropStoredFiles } from "./attachments";
import { logFailure, query, withStamp, writeStamped } from "./client";
import { deletionStatement } from "./deletions";
import { listSchema, sectionSchema, type SaveResult, type Section, type TaskList } from "./types";

function parseList(row: unknown): TaskList {
  return listSchema.parse(row);
}

export async function loadLists(): Promise<TaskList[]> {
  const rows = await query<unknown>(
    `SELECT id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at
     FROM lists
     WHERE archived_at IS NULL
     ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map(parseList);
}

export async function loadSections(): Promise<Section[]> {
  const rows = await query<unknown>(
    `SELECT id, list_id, name, sort_order, updated_at FROM sections ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((row) => sectionSchema.parse(row));
}

export function firstSectionId(sections: Section[], listId: string): string | null {
  const match = sections.filter((section) => section.listId === listId).sort(compareSections);
  return match[0]?.id ?? null;
}

export async function createList(nameInput: string, color: string): Promise<SaveResult<TaskList>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const hex = color.toLowerCase();
  if (!STICKERS.some((sticker) => sticker.hex === hex)) {
    return { status: "error", message: "Pick a list color." };
  }
  const id = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  try {
    const maxRows = await query<{ max_sort: number | null }>(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM lists",
    );
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    const { stamp } = await writeStamped((stamp) => [
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
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function renameList(list: TaskList, nameInput: string): Promise<SaveResult<TaskList>> {
  if (list.isInbox || list.id === "inbox") {
    return { status: "error", message: "Inbox stays Inbox." };
  }
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE lists SET name = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4 AND is_inbox = 0`,
        values: [cleaned.name, stamp, list.id, list.updatedAt],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) {
      const rows = await query<unknown>("SELECT * FROM lists WHERE id = $1", [list.id]);
      return { status: "conflict", current: rows[0] ? parseList(rows[0]) : null };
    }
    return { status: "saved", row: { ...list, name: cleaned.name, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function loadArchivedLists(): Promise<TaskList[]> {
  const rows = await query<unknown>(
    `SELECT id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at
     FROM lists WHERE archived_at IS NOT NULL ORDER BY name ASC`,
  );
  return rows.map(parseList);
}

export async function archiveList(list: TaskList): Promise<SaveResult<TaskList>> {
  if (list.isInbox) return { status: "error", message: "Inbox stays in the sidebar." };
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE lists SET archived_at = $1, updated_at = $1 WHERE id = $2 AND is_inbox = 0 AND archived_at IS NULL`,
        values: [stamp, list.id],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...list, archivedAt: stamp, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function purgeList(list: TaskList): Promise<SaveResult<{ id: string }>> {
  if (list.isInbox) return { status: "error", message: "Inbox stays in the sidebar." };
  try {
    const rows = await query<{ id: string }>(
      `SELECT id FROM lists WHERE id = $1 AND is_inbox = 0 AND archived_at IS NOT NULL`,
      [list.id],
    );
    if (rows.length === 0) return { status: "error", message: "Not saved" };
    const tasks = await query<{ id: string }>(`SELECT id FROM tasks WHERE list_id = $1`, [list.id]);
    const files = await attachmentIdsForTasks(tasks.map((task) => task.id));
    await withStamp(async (stamp, run) => {
      await run([
        ...tasks.map((task) => deletionStatement("tasks", task.id, stamp)),
        deletionStatement("lists", list.id, stamp),
        { sql: `DELETE FROM tasks WHERE list_id = $1 AND parent_id IS NOT NULL`, values: [list.id] },
        { sql: `DELETE FROM tasks WHERE list_id = $1`, values: [list.id] },
        { sql: `DELETE FROM lists WHERE id = $1 AND is_inbox = 0 AND archived_at IS NOT NULL`, values: [list.id] },
      ]);
    });
    await dropStoredFiles(files);
    return { status: "saved", row: { id: list.id } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function restoreList(list: TaskList): Promise<SaveResult<TaskList>> {
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE lists SET archived_at = NULL, updated_at = $1 WHERE id = $2`,
        values: [stamp, list.id],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...list, archivedAt: null, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function recolorList(list: TaskList, color: string): Promise<SaveResult<TaskList>> {
  const hex = color.toLowerCase();
  if (!STICKERS.some((sticker) => sticker.hex === hex)) return { status: "error", message: "Pick a list color." };
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE lists SET color = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4`,
        values: [hex, stamp, list.id, list.updatedAt],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) return { status: "conflict", current: list };
    return { status: "saved", row: { ...list, color: hex, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export type Folder = { id: string; name: string; sortOrder: number; updatedAt: string };

export async function loadFolders(): Promise<Folder[]> {
  const rows = await query<{ id: string; name: string; sort_order: number | string; updated_at: string }>(
    `SELECT id, name, sort_order, updated_at FROM folders ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order),
    updatedAt: row.updated_at,
  }));
}

export async function createFolder(nameInput: string): Promise<SaveResult<Folder>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const id = crypto.randomUUID();
  try {
    const maxRows = await query<{ max_sort: number | null }>(`SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM folders`);
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    const { stamp } = await writeStamped((stamp) => [
      {
        sql: `INSERT INTO folders (id, name, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
        values: [id, cleaned.name, sortOrder, stamp],
      },
    ]);
    return { status: "saved", row: { id, name: cleaned.name, sortOrder, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function renameFolder(folder: Folder, nameInput: string): Promise<SaveResult<Folder>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE folders SET name = $1, updated_at = $2 WHERE id = $3`,
        values: [cleaned.name, stamp, folder.id],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...folder, name: cleaned.name, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

/** Unlink this folder's lists, record the deletion, then delete the folder. */
export async function deleteFolder(folderId: string): Promise<SaveResult<{ id: string }>> {
  const existing = await query<{ id: string }>(`SELECT id FROM folders WHERE id = $1`, [folderId]);
  if (existing.length === 0) return { status: "error", message: "Not saved" };
  try {
    await withStamp(async (stamp, run) => {
      await run([
        { sql: `UPDATE lists SET folder_id = NULL, updated_at = $1 WHERE folder_id = $2`, values: [stamp, folderId] },
        deletionStatement("folders", folderId, stamp),
        { sql: `DELETE FROM folders WHERE id = $1`, values: [folderId] },
      ]);
    });
    return { status: "saved", row: { id: folderId } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function assignFolder(list: TaskList, folderId: string | null): Promise<SaveResult<TaskList>> {
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE lists SET folder_id = $1, updated_at = $2 WHERE id = $3`,
        values: [folderId, stamp, list.id],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...list, folderId, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function createSection(listId: string, nameInput: string): Promise<SaveResult<Section>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const id = crypto.randomUUID();
  try {
    const maxRows = await query<{ max_sort: number | null }>(
      `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM sections WHERE list_id = $1`,
      [listId],
    );
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    const { stamp } = await writeStamped((stamp) => [
      {
        sql: `INSERT INTO sections (id, list_id, name, sort_order, updated_at) VALUES ($1, $2, $3, $4, $5)`,
        values: [id, listId, cleaned.name, sortOrder, stamp],
      },
    ]);
    return { status: "saved", row: { id, listId, name: cleaned.name, sortOrder, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

/** Stamps updated_at so a later sync can see the new order. */
export async function reorderLists(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await writeStamped((stamp) =>
    ids.map((id, index) => ({
      sql: `UPDATE lists SET sort_order = $1, updated_at = $2 WHERE id = $3`,
      values: [index, stamp, id],
    })),
  );
}

/** Stamps updated_at so a later sync can see the new order. */
export async function reorderFolders(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await writeStamped((stamp) =>
    ids.map((id, index) => ({
      sql: `UPDATE folders SET sort_order = $1, updated_at = $2 WHERE id = $3`,
      values: [index, stamp, id],
    })),
  );
}

export async function renameSection(section: Section, nameInput: string): Promise<SaveResult<Section>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE sections SET name = $1, updated_at = $2 WHERE id = $3 AND list_id = $4`,
        values: [cleaned.name, stamp, section.id, section.listId],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...section, name: cleaned.name, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

/** Move this section's tasks to the first remaining section, then delete it. */
export async function deleteSection(sectionId: string, listId: string): Promise<SaveResult<{ id: string }>> {
  try {
    const rows = await query<unknown>(
      `SELECT id, list_id, name, sort_order, updated_at FROM sections WHERE list_id = $1`,
      [listId],
    );
    const sections = rows.map((row) => sectionSchema.parse(row));
    if (!sections.some((item) => item.id === sectionId)) return { status: "error", message: "Not saved" };
    const plan = sectionDeletePlan(sections, sectionId);
    if ("error" in plan) return { status: "error", message: plan.error };
    await withStamp(async (stamp, run) => {
      await run([
        {
          sql: `UPDATE tasks SET section_id = $1, updated_at = $2 WHERE section_id = $3`,
          values: [plan.targetId, stamp, sectionId],
        },
        deletionStatement("sections", sectionId, stamp),
        { sql: `DELETE FROM sections WHERE id = $1 AND list_id = $2`, values: [sectionId, listId] },
      ]);
    });
    return { status: "saved", row: { id: sectionId } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

/** Stamps updated_at so a later sync can see the new order. */
export async function reorderSections(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await writeStamped((stamp) =>
    ids.map((id, index) => ({
      sql: `UPDATE sections SET sort_order = $1, updated_at = $2 WHERE id = $3`,
      values: [index, stamp, id],
    })),
  );
}

export { DEFAULT_LIST_COLOR };
