import { z } from "zod";
import { nowIso } from "../lib/clock";
import { STICKERS } from "../lib/stickers";
import { cleanListName } from "../lib/validate";
import { logFailure, query, run } from "./client";
import type { SaveResult } from "./types";

const tagRow = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  created_at: z.string(),
});

export type Tag = { id: string; name: string; color: string; createdAt: string };

function parseTag(row: unknown): Tag {
  const parsed = tagRow.parse(row);
  return { id: parsed.id, name: parsed.name, color: parsed.color, createdAt: parsed.created_at };
}

export async function loadTags(): Promise<Tag[]> {
  const rows = await query<unknown>(`SELECT id, name, color, created_at FROM tags ORDER BY name COLLATE NOCASE ASC`);
  return rows.map(parseTag);
}

export async function tagsForTask(taskId: string): Promise<Tag[]> {
  const rows = await query<unknown>(
    `SELECT tags.id, tags.name, tags.color, tags.created_at
     FROM tags JOIN task_tags ON task_tags.tag_id = tags.id
     WHERE task_tags.task_id = $1
     ORDER BY tags.name COLLATE NOCASE ASC`,
    [taskId],
  );
  return rows.map(parseTag);
}

export async function taskTagLinks(): Promise<Array<{ taskId: string; tagId: string }>> {
  const rows = await query<{ task_id: string; tag_id: string }>(`SELECT task_id, tag_id FROM task_tags`);
  return rows.map((row) => ({ taskId: row.task_id, tagId: row.tag_id }));
}

export async function createTag(nameInput: string, color: string): Promise<SaveResult<Tag>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const hex = color.toLowerCase();
  if (!STICKERS.some((sticker) => sticker.hex === hex)) return { status: "error", message: "Pick a tag color." };
  const id = crypto.randomUUID();
  const stamp = nowIso();
  try {
    await run(`INSERT INTO tags (id, name, color, created_at) VALUES ($1, $2, $3, $4)`, [id, cleaned.name, hex, stamp]);
    return { status: "saved", row: { id, name: cleaned.name, color: hex, createdAt: stamp } };
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "That tag already exists." };
  }
}

export async function renameTag(tag: Tag, nameInput: string): Promise<SaveResult<Tag>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    const affected = await run(`UPDATE tags SET name = $1 WHERE id = $2`, [cleaned.name, tag.id]);
    if (affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...tag, name: cleaned.name } };
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "That tag already exists." };
  }
}

export async function tagUseCount(tagId: string): Promise<number> {
  const rows = await query<{ n: number | string }>(`SELECT COUNT(*) AS n FROM task_tags WHERE tag_id = $1`, [tagId]);
  return Number(rows[0]?.n ?? 0);
}

export async function deleteTag(tagId: string): Promise<SaveResult<{ id: string }>> {
  const used = await tagUseCount(tagId);
  if (used > 0) return { status: "error", message: `This tag is on ${used} tasks.` };
  try {
    const affected = await run(`DELETE FROM tags WHERE id = $1`, [tagId]);
    if (affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id: tagId } };
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function removeTagFromTasks(tagId: string): Promise<SaveResult<{ id: string }>> {
  try {
    await run(`DELETE FROM task_tags WHERE tag_id = $1`, [tagId]);
    return deleteTag(tagId);
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function setTaskTag(taskId: string, tagId: string, on: boolean): Promise<SaveResult<{ id: string }>> {
  try {
    if (on) {
      await run(`INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)`, [taskId, tagId]);
    } else {
      await run(`DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2`, [taskId, tagId]);
    }
    return { status: "saved", row: { id: tagId } };
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "Not saved" };
  }
}
