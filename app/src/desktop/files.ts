import { invoke } from "@tauri-apps/api/core";

export function copyAttachment(source: string, id: string): Promise<number> {
  return invoke("copy_attachment", { source, id });
}

export function openAttachment(id: string): Promise<void> {
  return invoke("open_attachment", { id });
}

export function deleteAttachmentFiles(ids: string[]): Promise<void> {
  return invoke("delete_attachment_files", { ids });
}

export function presentAttachmentIds(ids: string[]): Promise<string[]> {
  return invoke("present_attachment_ids", { ids });
}

export function sweepAttachments(ids: string[]): Promise<void> {
  return invoke("sweep_attachments", { ids });
}
