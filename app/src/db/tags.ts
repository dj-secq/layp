import { STICKERS, cleanListName, tagSchema, type Tag } from "@layp/shared";
import { logFailure, query, withStamp, writeStamped } from "./client";
import { deletionStatement } from "./deletions";
import type { SaveResult } from "./types";

export type { Tag };

function parseTag(row: unknown): Tag {
  return tagSchema.parse(row);
}

export async function loadTags(): Promise<Tag[]> {
  const rows = await query<unknown>(
    `SELECT id, name, color, created_at, updated_at FROM tags ORDER BY name COLLATE NOCASE ASC`,
  );
  return rows.map(parseTag);
}

export async function tagsForTask(taskId: string): Promise<Tag[]> {
  const rows = await query<unknown>(
    `SELECT tags.id, tags.name, tags.color, tags.created_at, tags.updated_at
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
  try {
    const { stamp } = await writeStamped((stamp) => [
      {
        sql: `INSERT INTO tags (id, name, color, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
        values: [id, cleaned.name, hex, stamp],
      },
    ]);
    return { status: "saved", row: { id, name: cleaned.name, color: hex, createdAt: stamp, updatedAt: stamp } };
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "That tag already exists." };
  }
}

export async function renameTag(tag: Tag, nameInput: string): Promise<SaveResult<Tag>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    const { stamp, batches } = await writeStamped((stamp) => [
      {
        sql: `UPDATE tags SET name = $1, updated_at = $2 WHERE id = $3`,
        values: [cleaned.name, stamp, tag.id],
      },
    ]);
    if ((batches[0]?.rowsAffected ?? 0) === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...tag, name: cleaned.name, updatedAt: stamp } };
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
  const rows = await query<{ id: string }>(`SELECT id FROM tags WHERE id = $1`, [tagId]);
  if (rows.length === 0) return { status: "error", message: "Not saved" };
  try {
    await withStamp(async (stamp, run) => {
      await run([
        deletionStatement("tags", tagId, stamp),
        { sql: `DELETE FROM tags WHERE id = $1`, values: [tagId] },
      ]);
    });
    return { status: "saved", row: { id: tagId } };
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function removeTagFromTasks(tagId: string): Promise<SaveResult<{ id: string }>> {
  const rows = await query<{ id: string }>(`SELECT id FROM tags WHERE id = $1`, [tagId]);
  if (rows.length === 0) return { status: "error", message: "Not saved" };
  try {
    await withStamp(async (stamp, run) => {
      await run([
        { sql: `DELETE FROM task_tags WHERE tag_id = $1`, values: [tagId] },
        deletionStatement("tags", tagId, stamp),
        { sql: `DELETE FROM tags WHERE id = $1`, values: [tagId] },
      ]);
    });
    return { status: "saved", row: { id: tagId } };
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function setTaskTag(taskId: string, tagId: string, on: boolean): Promise<SaveResult<{ id: string }>> {
  try {
    await writeStamped((stamp) => [
      on
        ? { sql: `INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)`, values: [taskId, tagId] }
        : { sql: `DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2`, values: [taskId, tagId] },
      { sql: `UPDATE tasks SET updated_at = $1 WHERE id = $2`, values: [stamp, taskId] },
    ]);
    return { status: "saved", row: { id: tagId } };
  } catch {
    await logFailure("tag save failed");
    return { status: "error", message: "Not saved" };
  }
}
