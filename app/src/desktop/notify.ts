import { invoke } from "@tauri-apps/api/core";

export function showReminder(input: { title: string; body: string; taskId: string | null }): Promise<void> {
  return invoke("show_reminder", {
    title: input.title.slice(0, 180),
    body: input.body.slice(0, 180),
    taskId: input.taskId,
  });
}
