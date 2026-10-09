import { Choice } from "@/components/choice";
import { Field } from "@/components/field";
import { PrimaryButton } from "@/components/primary-button";
import { RecurrenceEditor } from "@/components/recurrence-editor";
import { DIARY_PAUSE_MS } from "@/db/days";
import { firstSectionId } from "@/db/lists";
import { loadTaskEditor, patchTask, type TaskEditor, type TaskPatch } from "@/db/tasks";
import { usePhone } from "@/state/phone";
import { colors, ink, primary } from "@/theme/colors";
import { cleanDate, formatClock, parseClock, todayIso, type Priority, type Task } from "@layp/shared";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useColorScheme, View } from "react-native";

export default function TaskScreen() {
  useColorScheme();
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
  const [timeText, setTimeText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Task | null>(null);
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
    setTimeText(next.task?.dueTime ? formatClock(next.task.dueTime, next.clock) : "");
    setStatus(null);
    setConflict(null);
    setError(null);
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
      setTitle((current) => (current.trim() === result.row.title ? result.row.title : current));
      setDueText((current) => {
        const parsed = current.trim() ? cleanDate(current) : null;
        if (parsed === result.row.dueOn || current.trim() === "") return result.row.dueOn ?? "";
        return current;
      });
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

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (!id || (error && !editor)) {
    return (
      <Centered
        text={error ?? "Could not load this task."}
        action={id ? () => setRetry((value) => value + 1) : undefined}
      />
    );
  }
  if (!editor) return <Centered text="Opening the task…" />;
  if (!editor.task) return <Centered text="This task is in the trash." />;

  const task = editor.task;
  const sectionName = editor.sections.find((section) => section.id === task.sectionId)?.name;

  async function reload() {
    if (!id) return;
    const next = await loadTaskEditor(id);
    adopt(next);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Title>Task</Stack.Title>
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
      <Choice
        label="List"
        value={task.listId}
        options={editor.lists.map((list) => ({ value: list.id, label: list.name }))}
        onChange={(listId) => {
          if (listId === task.listId) return;
          enqueue({ listId, sectionId: firstSectionId(editor.sections, listId) });
        }}
      />
      {sectionName ? <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>{sectionName}</Text> : null}
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
      <Field
        label="Due date"
        value={dueText}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        onChangeText={setDueText}
        onBlur={() => {
          const current = draft.current;
          if (!current) return;
          const parsed = dueText.trim() ? cleanDate(dueText) : null;
          if (dueText.trim() && parsed === null) {
            setDueText(current.dueOn ?? "");
            return;
          }
          setDueText(parsed ?? "");
          if (parsed !== current.dueOn) enqueue({ dueOn: parsed });
        }}
      />
      <Field
        label="Due time"
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
      <RecurrenceEditor task={task} today={today} onSave={(patch) => enqueue(patch)} />
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
            <Text style={{ color: ink, fontSize: 17, fontWeight: "600" }}>Keep mine</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => adopt({ ...editor, task: conflict })}>
            <Text style={{ color: colors.label, fontSize: 17 }}>Use saved</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Centered({ text, action }: { text: string; action?: () => void }) {
  useColorScheme();
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
