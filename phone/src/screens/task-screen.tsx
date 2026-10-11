import { Choice } from "@/components/choice";
import { Field } from "@/components/field";
import { HeaderSearch } from "@/components/header-search";
import { PrimaryButton } from "@/components/primary-button";
import { RecurrenceEditor } from "@/components/recurrence-editor";
import { addChecklistReminder, removeChecklistReminder } from "@/db/checklist-reminders";
import { DIARY_PAUSE_MS } from "@/db/days";
import { firstSectionId } from "@/db/lists";
import { addReminder, removeReminder } from "@/db/reminders";
import { createTag, setTaskTag } from "@/db/tags";
import { restoreTask, trashTask } from "@/db/task-extra";
import { createTask, loadTaskEditor, patchTask, type TaskEditor, type TaskPatch } from "@/db/tasks";
import { refreshReminders } from "@/notify";
import { usePhone } from "@/state/phone";
import { colors, ink, onPrimary, primary } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import {
  STICKERS,
  checklistLines,
  cleanDate,
  cleanDuration,
  formatBytes,
  formatClock,
  parseClock,
  reminderLabel,
  todayIso,
  toggleChecklistLine,
  type Priority,
  type Task,
} from "@layp/shared";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Switch, Text, useColorScheme, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

const PRESETS = [0, 5, 15, 60, 1440];

export default function TaskScreen() {
  useColorScheme();
  usePaper();
  const phone = usePhone();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const today = todayIso();
  const [editor, setEditor] = useState<TaskEditor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueText, setDueText] = useState("");
  const [startText, setStartText] = useState("");
  const [timeText, setTimeText] = useState("");
  const [durationText, setDurationText] = useState("");
  const [pomoText, setPomoText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Task | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [subtask, setSubtask] = useState("");
  const [tagName, setTagName] = useState("");
  const [lineReminder, setLineReminder] = useState<string | null>(null);
  const [lineDate, setLineDate] = useState("");
  const [lineTime, setLineTime] = useState("");
  const [lineMinutes, setLineMinutes] = useState("0");
  const draft = useRef<Task | null>(null);
  const pending = useRef<TaskPatch | null>(null);
  const chain = useRef(Promise.resolve());
  const hydrated = useRef(false);

  function adopt(next: TaskEditor) {
    draft.current = next.task;
    setEditor(next);
    setTitle(next.task?.title ?? "");
    setNotes(next.task?.notes ?? "");
    setDueText(next.task?.dueOn ?? "");
    setStartText(next.task?.startOn ?? "");
    setTimeText(next.task?.dueTime ? formatClock(next.task.dueTime, next.clock) : "");
    setDurationText(next.task?.durationMinutes ? String(next.task.durationMinutes) : "");
    setPomoText(next.task?.estimatedPomos ? String(next.task.estimatedPomos) : "");
    setStatus(null);
    setConflict(null);
    setError(null);
    setConfirmTrash(false);
  }

  useEffect(() => {
    if (!phone.ready || !phone.hasKey || !id) return;
    let cancel = false;
    hydrated.current = false;
    setEditor(null);
    void loadTaskEditor(id).then(
      (next) => {
        if (cancel) return;
        adopt(next);
        hydrated.current = true;
      },
      () => {
        if (cancel) return;
        setError("Could not load this task.");
        hydrated.current = true;
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, id, retry]);

  function enqueue(patch: TaskPatch, force = false) {
    chain.current = chain.current.then(() => save(patch, force));
  }

  async function save(patch: TaskPatch, force = false) {
    const current = draft.current;
    if (!current) return;
    pending.current = patch;
    const result = await patchTask(current, patch, force);
    if (result.status === "saved") {
      draft.current = result.row;
      setEditor((value) => (value ? { ...value, task: result.row } : value));
      setTitle((shown) => (shown.trim() === result.row.title ? result.row.title : shown));
      setStatus(null);
      setConflict(null);
      phone.changed();
      return;
    }
    if (result.status === "error" && result.message === "Add a title." && draft.current) {
      setTitle(draft.current.title);
      setStatus(null);
      return;
    }
    setStatus(result.status === "error" ? result.message : "Not saved");
    if (result.status === "conflict" && result.current) setConflict(result.current);
  }

  useEffect(() => {
    const current = draft.current;
    if (!hydrated.current || !current || !id || current.id !== id || title.trim() === current.title) return;
    const handle = setTimeout(() => {
      if (draft.current?.id === id) enqueue({ title });
    }, DIARY_PAUSE_MS);
    return () => clearTimeout(handle);
  }, [title, id]);

  useEffect(() => {
    const current = draft.current;
    if (!hydrated.current || !current || !id || current.id !== id || notes === current.notes) return;
    const handle = setTimeout(() => {
      if (draft.current?.id === id) enqueue({ notes });
    }, DIARY_PAUSE_MS);
    return () => clearTimeout(handle);
  }, [notes, id]);

  async function reload() {
    if (!id) return;
    const next = await loadTaskEditor(id);
    adopt(next);
    hydrated.current = true;
  }

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (!id || (error && !editor)) {
    return <Centered text={error ?? "Could not load this task."} action={id ? () => setRetry((value) => value + 1) : undefined} />;
  }
  if (!editor) return <Centered text="Opening the task…" />;
  if (!editor.task) return <Centered text="This task is in the trash." />;

  const task = editor.task;
  const sections = editor.sections.filter((section) => section.listId === task.listId);
  const lines = checklistLines(notes);

  async function afterReminder() {
    await reload();
    phone.changed();
    await refreshReminders();
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <LaypTitle>Task</LaypTitle>
      <HeaderSearch />
      {status ? <Text selectable style={{ color: ink }}>{status}</Text> : null}
      <PrimaryButton
        label={task.completedAt ? "Reopen" : "Complete"}
        onPress={() => {
          void (task.completedAt ? phone.reopen(task.id) : phone.complete(task.id)).then(async (result) => {
            if (result === "error") {
              setStatus("Not saved");
              return;
            }
            await reload();
          });
        }}
      />
      {confirmTrash ? (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.label }}>
            {editor.childCount > 0 ? "Move to trash. Subtasks will be detached." : "Move this task to trash."}
          </Text>
          <PrimaryButton
            label="Move to trash"
            onPress={() => {
              void trashTask(task.id).then((result) => {
                if (result.status === "saved") {
                  phone.changed();
                  router.back();
                  return;
                }
                setStatus("Not saved");
              });
            }}
          />
          <TextButton label="Keep" onPress={() => setConfirmTrash(false)} />
        </View>
      ) : (
        <TextButton label="Move to trash" onPress={() => setConfirmTrash(true)} />
      )}
      <Field
        label="Title"
        value={title}
        maxLength={500}
        onChangeText={setTitle}
        onBlur={() => {
          if (draft.current && title.trim() !== draft.current.title) enqueue({ title });
        }}
      />
      <Field
        label="Notes"
        value={notes}
        multiline
        onChangeText={setNotes}
        onBlur={() => {
          if (draft.current && notes !== draft.current.notes) enqueue({ notes });
        }}
      />
      {lines.map((line) => (
        <View key={line.index} style={{ gap: 8 }}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: line.done }}
            onPress={() => {
              const next = toggleChecklistLine(notes, line.index);
              setNotes(next);
              enqueue({ notes: next });
            }}
            style={{ minHeight: 40, justifyContent: "center" }}
          >
            <Text style={{ color: colors.label, fontSize: 17 }}>{line.done ? "✓" : "○"} {line.text || "Checklist item"}</Text>
          </Pressable>
          <TextButton label={lineReminder === line.text ? "Hide reminder" : "Checklist reminder"} onPress={() => setLineReminder(lineReminder === line.text ? null : line.text)} />
          {lineReminder === line.text ? (
            <View style={{ gap: 8 }}>
              <Field label="Date" value={lineDate} placeholder="YYYY-MM-DD" autoCapitalize="none" onChangeText={setLineDate} />
              <Field label="Time" value={lineTime} autoCapitalize="characters" onChangeText={setLineTime} />
              <Field label="Minutes before" value={lineMinutes} keyboardType="number-pad" autoCapitalize="none" onChangeText={setLineMinutes} />
              <TextButton
                label="Save checklist reminder"
                onPress={() => {
                  const dueOn = cleanDate(lineDate);
                  if (!dueOn) {
                    setStatus("Add a due date.");
                    return;
                  }
                  void addChecklistReminder({
                    taskId: task.id,
                    notes,
                    lineText: line.text,
                    dueOn,
                    dueTime: parseClock(lineTime),
                    minutesBefore: Number(lineMinutes),
                  }).then(async (result) => {
                    if (result.status !== "saved") {
                      setStatus(result.message);
                      return;
                    }
                    setLineReminder(null);
                    await afterReminder();
                  });
                }}
              />
            </View>
          ) : null}
        </View>
      ))}
      {editor.checklistReminders.map((row) => (
        <View key={row.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15, flex: 1 }}>
            {row.lineText}: {row.dueOn} {reminderLabel(row.minutesBefore)}
          </Text>
          <TextButton label="Clear" onPress={() => void removeChecklistReminder(row.id).then(() => afterReminder())} />
        </View>
      ))}
      <Choice
        label="List"
        value={task.listId}
        options={editor.lists.map((list) => ({ value: list.id, label: list.name }))}
        onChange={(listId) => {
          if (listId === task.listId) return;
          enqueue({ listId, sectionId: firstSectionId(editor.sections, listId) });
        }}
      />
      {sections.length > 0 ? (
        <Choice
          label="Section"
          value={task.sectionId ?? sections[0]?.id ?? ""}
          options={sections.map((section) => ({ value: section.id, label: section.name }))}
          onChange={(sectionId) => {
            if (sectionId === task.sectionId) return;
            enqueue({ sectionId });
          }}
        />
      ) : null}
      <Choice
        label="Priority"
        value={task.priority}
        options={[
          { value: "none", label: "None" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ]}
        onChange={(priority) => {
          if (priority === task.priority) return;
          enqueue({ priority: priority as Priority });
        }}
      />
      <Field label="Start" value={startText} placeholder="YYYY-MM-DD" autoCapitalize="none" onChangeText={setStartText} onBlur={() => saveDate(startText, "startOn", setStartText)} />
      <Field label="Due date" value={dueText} placeholder="YYYY-MM-DD" autoCapitalize="none" onChangeText={setDueText} onBlur={() => saveDate(dueText, "dueOn", setDueText)} />
      <Field
        label="Time"
        value={timeText}
        placeholder={editor.clock === "12" ? "6:00 PM" : "18:00"}
        autoCapitalize="characters"
        onChangeText={setTimeText}
        onBlur={() => {
          const current = draft.current;
          if (!current) return;
          const parsed = parseClock(timeText);
          if (timeText.trim() && parsed === null) {
            setTimeText(current.dueTime ? formatClock(current.dueTime, editor.clock) : "");
            return;
          }
          setTimeText(parsed ? formatClock(parsed, editor.clock) : "");
          if (parsed !== current.dueTime) enqueue({ dueTime: parsed });
        }}
      />
      <Field
        label="Duration minutes"
        value={durationText}
        keyboardType="number-pad"
        autoCapitalize="none"
        onChangeText={setDurationText}
        onBlur={() => {
          const current = draft.current;
          if (!current) return;
          const parsed = cleanDuration(durationText);
          if ("error" in parsed) {
            setDurationText(current.durationMinutes ? String(current.durationMinutes) : "");
            setStatus(parsed.error);
            return;
          }
          setDurationText(parsed.minutes ? String(parsed.minutes) : "");
          if (parsed.minutes !== current.durationMinutes) enqueue({ durationMinutes: parsed.minutes });
        }}
      />
      <Flag label="Important" value={task.important} onChange={(important) => enqueue({ important })} />
      <Flag label="Urgent" value={task.urgent} onChange={(urgent) => enqueue({ urgent })} />
      <Flag label="Pinned" value={task.pinned} onChange={(pinned) => enqueue({ pinned })} />
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Tags</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {editor.tags.map((tag) => {
          const on = editor.taskTags.some((row) => row.id === tag.id);
          return (
            <Pressable
              key={tag.id}
              accessibilityRole="button"
              onPress={() => {
                void setTaskTag(task.id, tag.id, !on).then((result) => {
                  if (result.status !== "saved") setStatus(result.message);
                  else void reload().then(() => phone.changed());
                });
              }}
              style={{ backgroundColor: on ? tag.color : colors.grouped, borderRadius: 8, borderCurve: "continuous", paddingHorizontal: 10, paddingVertical: 8 }}
            >
              <Text style={{ color: on ? "#111111" : colors.label }}>{tag.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field label="New tag" value={tagName} onChangeText={setTagName} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {STICKERS.map((sticker) => (
          <Pressable
            key={sticker.hex}
            accessibilityRole="button"
            accessibilityLabel={sticker.name}
            onPress={() => {
              void createTag(tagName, sticker.hex).then(async (result) => {
                if (result.status !== "saved") {
                  setStatus(result.message);
                  return;
                }
                await setTaskTag(task.id, result.row.id, true);
                setTagName("");
                await reload();
                phone.changed();
              });
            }}
            style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: sticker.hex }}
          />
        ))}
      </View>
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Reminders</Text>
      {task.dueOn ? null : <Text style={{ color: colors.label }}>Add a due date to set a reminder.</Text>}
      {editor.reminders.map((row) => (
        <View key={row.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: colors.label, fontSize: 16 }}>{reminderLabel(row.minutesBefore)}</Text>
          <TextButton
            label="Remove"
            onPress={() => {
              void removeReminder(row.id).then(async (result) => {
                if (result.status !== "saved") setStatus(result.message);
                else await afterReminder();
              });
            }}
          />
        </View>
      ))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PRESETS.map((minutes) => (
          <TextButton
            key={minutes}
            label={reminderLabel(minutes)}
            onPress={() => {
              void addReminder(task.id, minutes).then(async (result) => {
                if (result.status !== "saved") setStatus(result.message);
                else await afterReminder();
              });
            }}
          />
        ))}
      </View>
      <RecurrenceEditor task={task} today={today} onSave={(patch) => enqueue(patch)} />
      <Field
        label="Estimated pomodoros"
        value={pomoText}
        keyboardType="number-pad"
        autoCapitalize="none"
        onChangeText={setPomoText}
        onBlur={() => {
          const current = draft.current;
          if (!current) return;
          const trimmed = pomoText.trim();
          const minutes = trimmed ? Number(trimmed) : null;
          if (trimmed && (!Number.isInteger(minutes) || (minutes ?? 0) < 1 || (minutes ?? 0) > 99)) {
            setPomoText(current.estimatedPomos ? String(current.estimatedPomos) : "");
            setStatus("Estimated pomodoros can be 1 to 99.");
            return;
          }
          if (minutes !== current.estimatedPomos) enqueue({ estimatedPomos: minutes });
        }}
      />
      <TextButton label="Start focus" onPress={() => router.push({ pathname: "/focus", params: { taskId: task.id } })} />
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Subtasks</Text>
      {editor.children.map((child) => (
        <Pressable key={child.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/task/[id]", params: { id: child.id } })}>
          <Text style={{ color: colors.label, fontSize: 17 }}>{child.completedAt ? "✓" : "○"} {child.title}</Text>
        </Pressable>
      ))}
      <Field label="Add a subtask" value={subtask} onChangeText={setSubtask} />
      <TextButton
        label="Add subtask"
        onPress={() => {
          const name = subtask.trim();
          if (!name) return;
          void createTask({
            title: name,
            listId: task.listId,
            sectionId: task.sectionId,
            parentId: task.id,
          }).then(async (result) => {
            if (result.status !== "saved") {
              setStatus(result.status === "error" ? result.message : "Not saved");
              return;
            }
            setSubtask("");
            await reload();
            phone.changed();
          });
        }}
      />
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Files</Text>
      {editor.files.length === 0 ? <Text style={{ color: colors.secondaryLabel }}>No files.</Text> : null}
      {editor.files.map((file) => (
        <Text key={file.id} selectable style={{ color: colors.label, fontSize: 16 }}>
          {file.fileName} · {formatBytes(file.byteSize)}. File is on the computer.
        </Text>
      ))}
      <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>History stays on the computer.</Text>
      {task.deletedAt ? (
        <TextButton
          label="Restore"
          onPress={() => {
            void restoreTask(task.id).then(async (result) => {
              if (result.status !== "saved") setStatus("Not saved");
              else {
                await reload();
                phone.changed();
              }
            });
          }}
        />
      ) : null}
      {conflict ? (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.label }}>
            This was saved from a newer edit. Your latest keystrokes are still in the form.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const patch = pending.current;
              setConflict(null);
              if (patch) enqueue(patch, true);
            }}
            style={{ backgroundColor: primary, borderRadius: 14, borderCurve: "continuous", paddingVertical: 12, alignItems: "center" }}
          >
            <Text style={{ color: onPrimary, fontSize: 17, fontWeight: "600" }}>Keep mine</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => adopt({ ...editor, task: conflict })}>
            <Text style={{ color: colors.label, fontSize: 17 }}>Use saved</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );

  function saveDate(text: string, key: "dueOn" | "startOn", setText: (value: string) => void) {
    const current = draft.current;
    if (!current) return;
    const parsed = text.trim() ? cleanDate(text) : null;
    if (text.trim() && parsed === null) {
      setText((key === "dueOn" ? current.dueOn : current.startOn) ?? "");
      return;
    }
    setText(parsed ?? "");
    const previous = key === "dueOn" ? current.dueOn : current.startOn;
    if (parsed !== previous) enqueue({ [key]: parsed });
  }
}

function Flag({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  usePaper();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      <Text style={{ color: colors.label, fontSize: 17 }}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  usePaper();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 40, justifyContent: "center" }}>
      <Text style={{ color: colors.label, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}

function Centered({ text, action }: { text: string; action?: () => void }) {
  usePaper();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: "center", gap: 12 }}>
      <Text selectable style={{ color: colors.label, fontSize: 17 }}>{text}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action}>
          <Text style={{ color: colors.label, fontSize: 17 }}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
