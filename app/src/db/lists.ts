import { nowIso } from "../lib/clock";
import { DEFAULT_LIST_COLOR, STICKERS } from "../lib/stickers";
import { cleanListName } from "../lib/validate";
import { attachmentIdsForTasks, dropStoredFiles } from "./attachments";
import { logFailure, query, run } from "./client";
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
    `SELECT id, list_id, name, sort_order FROM sections ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((row) => sectionSchema.parse(row));
}

export function firstSectionId(sections: Section[], listId: string): string | null {
  const match = sections
    .filter((section) => section.listId === listId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
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
  const stamp = nowIso();
  try {
    const maxRows = await query<{ max_sort: number | null }>(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM lists",
    );
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    await run(
      `INSERT INTO lists (id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at)
       VALUES ($1, NULL, $2, $3, $4, NULL, 0, $5, $5)`,
      [id, cleaned.name, hex, sortOrder, stamp],
    );
    await run(`INSERT INTO sections (id, list_id, name, sort_order) VALUES ($1, $2, 'Open', 0)`, [
      sectionId,
      id,
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
  } catch (err) {
    await logFailure("list save failed");
    await run("DELETE FROM lists WHERE id = $1 AND is_inbox = 0", [id]).catch(() => undefined);
    return { status: "error", message: "Not saved" };
  }
}

export async function renameList(list: TaskList, nameInput: string): Promise<SaveResult<TaskList>> {
  if (list.isInbox || list.id === "inbox") {
    return { status: "error", message: "Inbox stays Inbox." };
  }
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const stamp = nowIso();
  try {
    const affected = await run(
      `UPDATE lists SET name = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4 AND is_inbox = 0`,
      [cleaned.name, stamp, list.id, list.updatedAt],
    );
    if (affected === 0) {
      const rows = await query<unknown>("SELECT * FROM lists WHERE id = $1", [list.id]);
      return { status: "conflict", current: rows[0] ? parseList(rows[0]) : null };
    }
    return { status: "saved", row: { ...list, name: cleaned.name, updatedAt: stamp } };
  } catch (err) {
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
  const stamp = nowIso();
  try {
    const affected = await run(
      `UPDATE lists SET archived_at = $1, updated_at = $1 WHERE id = $2 AND is_inbox = 0 AND archived_at IS NULL`,
      [stamp, list.id],
    );
    if (affected === 0) return { status: "error", message: "Not saved" };
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
    await run(`DELETE FROM tasks WHERE list_id = $1 AND parent_id IS NOT NULL`, [list.id]);
    await run(`DELETE FROM tasks WHERE list_id = $1`, [list.id]);
    await dropStoredFiles(files);
    const affected = await run(`DELETE FROM lists WHERE id = $1 AND is_inbox = 0 AND archived_at IS NOT NULL`, [list.id]);
    if (affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id: list.id } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function restoreList(list: TaskList): Promise<SaveResult<TaskList>> {
  const stamp = nowIso();
  try {
    const affected = await run(`UPDATE lists SET archived_at = NULL, updated_at = $1 WHERE id = $2`, [stamp, list.id]);
    if (affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...list, archivedAt: null, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function recolorList(list: TaskList, color: string): Promise<SaveResult<TaskList>> {
  const hex = color.toLowerCase();
  if (!STICKERS.some((sticker) => sticker.hex === hex)) return { status: "error", message: "Pick a list color." };
  const stamp = nowIso();
  try {
    const affected = await run(`UPDATE lists SET color = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4`, [
      hex,
      stamp,
      list.id,
      list.updatedAt,
    ]);
    if (affected === 0) return { status: "conflict", current: list };
    return { status: "saved", row: { ...list, color: hex, updatedAt: stamp } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export type Folder = { id: string; name: string; sortOrder: number };

export async function loadFolders(): Promise<Folder[]> {
  const rows = await query<{ id: string; name: string; sort_order: number | string }>(
    `SELECT id, name, sort_order FROM folders ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, sortOrder: Number(row.sort_order) }));
}

export async function createFolder(nameInput: string): Promise<SaveResult<Folder>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const id = crypto.randomUUID();
  const stamp = nowIso();
  try {
    const maxRows = await query<{ max_sort: number | null }>(`SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM folders`);
    const sortOrder = Number(maxRows[0]?.max_sort ?? 0) + 1;
    await run(`INSERT INTO folders (id, name, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`, [
      id,
      cleaned.name,
      sortOrder,
      stamp,
    ]);
    return { status: "saved", row: { id, name: cleaned.name, sortOrder } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function assignFolder(list: TaskList, folderId: string | null): Promise<SaveResult<TaskList>> {
  const stamp = nowIso();
  try {
    const affected = await run(`UPDATE lists SET folder_id = $1, updated_at = $2 WHERE id = $3`, [folderId, stamp, list.id]);
    if (affected === 0) return { status: "error", message: "Not saved" };
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
    await run(`INSERT INTO sections (id, list_id, name, sort_order) VALUES ($1, $2, $3, $4)`, [id, listId, cleaned.name, sortOrder]);
    return { status: "saved", row: { id, listId, name: cleaned.name, sortOrder } };
  } catch {
    await logFailure("list save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function reorderLists(ids: string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await run(`UPDATE lists SET sort_order = $1 WHERE id = $2`, [index, ids[index]]);
  }
}

export async function reorderFolders(ids: string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await run(`UPDATE folders SET sort_order = $1 WHERE id = $2`, [index, ids[index]]);
  }
}

export async function reorderSections(ids: string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await run(`UPDATE sections SET sort_order = $1 WHERE id = $2`, [index, ids[index]]);
  }
}

export { DEFAULT_LIST_COLOR };
