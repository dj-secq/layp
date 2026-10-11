import { parseQuickAdd, type TaskList } from "@layp/shared";
import { firstSectionId, inboxList } from "./lists";
import type { NewTask } from "./tasks";

export type QuickPlan =
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "ready"; notice: string | null; input: NewTask };

type SectionRef = { id: string; listId: string; sortOrder: number; name: string };

/** A day or list the sheet was opened from, used only when the line does not name one. */
export type QuickDefaults = { listId?: string | null; dueOn?: string | null };

/** Parses one line. An unknown list name is a notice. This does not create a list. */
export function planQuickAdd(
  text: string,
  lists: TaskList[],
  sections: SectionRef[],
  now: { today: string; minutes: number | null },
  defaults?: QuickDefaults,
): QuickPlan {
  const parsed = parseQuickAdd(
    text,
    lists.map((list) => ({ id: list.id, name: list.name })),
    now,
  );
  if (parsed.status === "empty") return { status: "empty" };
  if (parsed.status === "reject") return { status: "error", message: "Add a title." };
  const listId = parsed.listId ?? defaults?.listId ?? inboxList(lists)?.id ?? null;
  if (!listId) return { status: "error", message: "Not saved" };
  return {
    status: "ready",
    notice: parsed.notice,
    input: {
      title: parsed.title,
      notes: "",
      listId,
      sectionId: firstSectionId(sections, listId),
      dueOn: parsed.dueOn ?? defaults?.dueOn ?? null,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      important: parsed.important,
      recurrence: parsed.recurrence,
    },
  };
}
