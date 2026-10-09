import { z } from "zod";
import { deleteAttachmentFiles, presentAttachmentIds, sweepAttachments } from "../desktop/files";
import { attachmentBlock, fileTitle } from "@layp/shared";
import { logFailure, query, withStamp, writeStamped } from "./client";
import { recordDeletion } from "./deletions";
import type { SaveResult } from "./types";

const count = z.union([z.number(), z.string()]).transform((value) => Number(value));

const storedRow = z.object({
  id: z.string(),
  file_name: z.string(),
  byte_size: count,
  created_at: z.string(),
});

export type Attachment = {
  id: string;
  fileName: string;
  byteSize: number;
  createdAt: string;
  missing: boolean;
};

export async function attachmentsForTask(taskId: string): Promise<Attachment[]> {
  const rows = await query<unknown>(
    `SELECT id, file_name, byte_size, created_at FROM attachments WHERE task_id = $1 ORDER BY created_at ASC`,
    [taskId],
  );
  const parsed = rows.map((row) => storedRow.parse(row));
  const present = new Set(await presentAttachmentIds(parsed.map((row) => row.id)));
  return parsed.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    missing: !present.has(row.id),
  }));
}

export async function addAttachment(taskId: string, sourcePath: string, byteSize: number, id: string): Promise<SaveResult<Attachment>> {
  const fileName = fileTitle(sourcePath);
  const existing = await query<{ id: string }>(`SELECT id FROM attachments WHERE task_id = $1`, [taskId]);
  const block = attachmentBlock(existing.length);
  if (block) return { status: "error", message: block };
  try {
    const { stamp } = await writeStamped((stamp) => [
      {
        sql: `INSERT INTO attachments (id, task_id, file_name, byte_size, created_at) VALUES ($1, $2, $3, $4, $5)`,
        values: [id, taskId, fileName, byteSize, stamp],
      },
    ]);
    return { status: "saved", row: { id, fileName, byteSize, createdAt: stamp, missing: false } };
  } catch {
    await deleteAttachmentFiles([id]).catch(() => undefined);
    await logFailure("attachment failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function removeAttachment(id: string): Promise<SaveResult<{ id: string }>> {
  const rows = await query<{ id: string }>(`SELECT id FROM attachments WHERE id = $1`, [id]);
  if (rows.length === 0) return { status: "error", message: "Not saved" };
  try {
    await withStamp(async (stamp, run) => {
      await recordDeletion("attachments", id, stamp, run, [
        { sql: `DELETE FROM attachments WHERE id = $1`, values: [id] },
      ]);
    });
    await deleteAttachmentFiles([id]);
    return { status: "saved", row: { id } };
  } catch {
    await logFailure("attachment failed");
    return { status: "error", message: "Not saved" };
  }
}

export async function attachmentIdsForTasks(taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const marks = taskIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await query<{ id: string }>(`SELECT id FROM attachments WHERE task_id IN (${marks})`, taskIds);
  return rows.map((row) => row.id);
}

export async function trashedAttachmentIds(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT a.id FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.deleted_at IS NOT NULL`,
  );
  return rows.map((row) => row.id);
}

export async function dropStoredFiles(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await deleteAttachmentFiles(ids);
  } catch {
    await logFailure("attachment failed");
  }
}

export async function sweepStoredFiles(): Promise<void> {
  const rows = await query<{ id: string }>(`SELECT id FROM attachments`);
  await sweepAttachments(rows.map((row) => row.id));
}
