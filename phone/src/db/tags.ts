import { STICKERS, cleanListName, tagSchema, type Tag } from "@layp/shared";
import { randomUUID } from "../link/random";
import { withLock, withStamp } from "./lock";
import type { Run, SqlStatement } from "./sql";

export type TagSave<T> = { status: "saved"; row: T } | { status: "error"; message: string };

function deletion(entity: string, entityId: string, stamp: string): SqlStatement {
  return {
    sql: `INSERT INTO deletions (id, entity, entity_id, deleted_at) VALUES ($1, $2, $3, $4)`,
    values: [randomUUID(), entity, entityId, stamp],
  };
}

export function taskTagLinks(): Promise<Array<{ taskId: string; tagId: string }>> {
  return withLock(async (run) => {
    const loaded = await run([{ sql: `SELECT task_id, tag_id FROM task_tags`, values: [] }]);
    return (loaded.batches[0]?.rows ?? []).flatMap((row) =>
      typeof row.task_id === "string" && typeof row.tag_id === "string" ? [{ taskId: row.task_id, tagId: row.tag_id }] : [],
    );
  });
}

export async function loadTags(): Promise<Tag[]> {
  return withLock(async (run) => {
    const loaded = await run([{ sql: `SELECT id, name, color, created_at, updated_at FROM tags ORDER BY name COLLATE NOCASE ASC`, values: [] }]);
    return (loaded.batches[0]?.rows ?? []).flatMap((row) => {
      const parsed = tagSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  });
}

export async function createTag(nameInput: string, color: string): Promise<TagSave<Tag>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  const hex = color.toLowerCase();
  if (!STICKERS.some((sticker) => sticker.hex === hex)) return { status: "error", message: "Pick a tag color." };
  const id = randomUUID();
  try {
    const stamp = await withStamp(async (stamp, run) => {
      await run([
        {
          sql: `INSERT INTO tags (id, name, color, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
          values: [id, cleaned.name, hex, stamp],
        },
      ]);
      return stamp;
    });
    return { status: "saved", row: { id, name: cleaned.name, color: hex, createdAt: stamp, updatedAt: stamp } };
  } catch {
    return { status: "error", message: "That tag already exists." };
  }
}

export async function renameTag(tag: Tag, nameInput: string): Promise<TagSave<Tag>> {
  const cleaned = cleanListName(nameInput);
  if ("error" in cleaned) return { status: "error", message: cleaned.error };
  try {
    const saved = await withStamp(async (stamp, run) => {
      const result = await run([
        { sql: `UPDATE tags SET name = $1, updated_at = $2 WHERE id = $3`, values: [cleaned.name, stamp, tag.id] },
      ]);
      return { stamp, affected: result.batches[0]?.rowsAffected ?? 0 };
    });
    if (saved.affected === 0) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { ...tag, name: cleaned.name, updatedAt: saved.stamp } };
  } catch {
    return { status: "error", message: "That tag already exists." };
  }
}

export async function tagUseCount(tagId: string): Promise<number> {
  return withLock(async (run) => {
    const loaded = await run([{ sql: `SELECT COUNT(*) AS n FROM task_tags WHERE tag_id = $1`, values: [tagId] }]);
    return Number(loaded.batches[0]?.rows[0]?.n ?? 0);
  });
}

export async function deleteTag(tagId: string): Promise<TagSave<{ id: string }>> {
  const used = await tagUseCount(tagId);
  if (used > 0) return { status: "error", message: `This tag is on ${used} tasks.` };
  return removeTag(tagId, false);
}

export async function removeTagFromTasks(tagId: string): Promise<TagSave<{ id: string }>> {
  return removeTag(tagId, true);
}

async function removeTag(tagId: string, clearLinks: boolean): Promise<TagSave<{ id: string }>> {
  try {
    const saved = await withStamp(async (stamp, run) => {
      const found = await run([{ sql: `SELECT id FROM tags WHERE id = $1`, values: [tagId] }]);
      if ((found.batches[0]?.rows.length ?? 0) === 0) return false;
      const statements: SqlStatement[] = [];
      if (clearLinks) statements.push({ sql: `DELETE FROM task_tags WHERE tag_id = $1`, values: [tagId] });
      statements.push(deletion("tags", tagId, stamp), { sql: `DELETE FROM tags WHERE id = $1`, values: [tagId] });
      await run(statements);
      return true;
    });
    if (!saved) return { status: "error", message: "Not saved" };
    return { status: "saved", row: { id: tagId } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function setTaskTag(taskId: string, tagId: string, on: boolean): Promise<TagSave<{ id: string }>> {
  try {
    await withStamp(async (stamp, run) => {
      await run([
        on
          ? { sql: `INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)`, values: [taskId, tagId] }
          : { sql: `DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2`, values: [taskId, tagId] },
        { sql: `UPDATE tasks SET updated_at = $1 WHERE id = $2`, values: [stamp, taskId] },
      ]);
    });
    return { status: "saved", row: { id: tagId } };
  } catch {
    return { status: "error", message: "Not saved" };
  }
}

export async function setTaskTagOn(run: Run, taskId: string, tagId: string, on: boolean, stamp: string): Promise<void> {
  await run([
    on
      ? { sql: `INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)`, values: [taskId, tagId] }
      : { sql: `DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2`, values: [taskId, tagId] },
    { sql: `UPDATE tasks SET updated_at = $1 WHERE id = $2`, values: [stamp, taskId] },
  ]);
}
