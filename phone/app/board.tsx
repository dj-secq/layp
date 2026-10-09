import { Field } from "@/components/field";
import { Choice } from "@/components/choice";
import { PrimaryButton } from "@/components/primary-button";
import {
  boardColumns,
  boardDrop,
  cardFacts,
  compareSections,
  FILE_ON_COMPUTER,
  moveBeforeId,
  moveDestinations,
  sectionDeletePlan,
  stepBeforeId,
  tagsOnCard,
  type BoardDrop,
} from "@/db/board";
import { createSection, deleteSection, renameSection, reorderSections } from "@/db/lists";
import { applyBoardDrop, loadBoard, type BoardFile, type BoardSnapshot } from "@/db/tasks";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { movedIds, type Section, type Task } from "@layp/shared";
import { Link, Redirect, Stack } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, useColorScheme, useWindowDimensions, View } from "react-native";

const PRIORITY_WORD = { high: "High", medium: "Medium", low: "Low" } as const;

export default function BoardScreen() {
  useColorScheme();
  const phone = usePhone();
  const { width } = useWindowDimensions();
  const columnWidth = Math.min(320, Math.max(240, width - 64));
  const [listId, setListId] = useState<string | null>(null);
  const [data, setData] = useState<BoardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const busy = useRef(false);

  function begin(): boolean {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    return true;
  }

  function finish(): void {
    busy.current = false;
    setPending(false);
  }

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    const requested = listId;
    void loadBoard(requested).then(
      (next) => {
        if (cancel) return;
        setData(next);
        if (next.list && next.list.id !== requested) setListId(next.list.id);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load the board.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry, listId]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;

  const sections = [...(data?.sections ?? [])].sort(compareSections);
  const columns = boardColumns(sections, data?.tasks ?? []);
  const done = columns.find((column) => column.id === "done");
  const openColumns = columns.filter((column) => column.id !== "done");
  const list = data?.list ?? null;

  function chooseList(id: string) {
    setListId(id);
    setRenamingId(null);
    setDeletingId(null);
    setMovingId(null);
    setMessage(null);
  }

  async function runPlan(task: Task, plan: BoardDrop) {
    if (plan.kind === "none") {
      setMovingId(null);
      return;
    }
    if (!begin()) return;
    try {
      const result = await applyBoardDrop(task, plan);
      if (result.status === "saved") {
        setMessage(null);
        setMovingId(null);
        phone.changed();
        return;
      }
      if (result.status === "error") setMessage(result.message);
    } finally {
      finish();
    }
  }

  function moveCard(task: Task, direction: -1 | 1) {
    const column = columns.find((item) => item.tasks.some((card) => card.id === task.id));
    if (!column) return;
    const ids = column.tasks.map((card) => card.id);
    const beforeId = stepBeforeId(ids, task.id, direction);
    if (beforeId === undefined) return;
    void runPlan(task, boardDrop(task, column.id, beforeId, ids));
  }

  function moveCardTo(task: Task, columnId: string) {
    const column = columns.find((item) => item.id === columnId);
    const from = columns.find((item) => item.tasks.some((card) => card.id === task.id));
    if (!column || !from) return;
    const ids = column.tasks.map((card) => card.id);
    void runPlan(task, boardDrop(task, column.id, moveBeforeId(ids, task.id, from.id === column.id), ids));
  }

  function moveColumn(sectionId: string, direction: -1 | 1) {
    const next = movedIds(
      sections.map((section) => section.id),
      sectionId,
      direction,
    );
    if (!next || !begin()) return;
    void reorderSections(next)
      .then((result) => {
        if (result === "saved") {
          setMessage(null);
          phone.changed();
          return;
        }
        setMessage("Not saved");
      })
      .finally(finish);
  }

  async function commitRename(section: Section) {
    if (draft.trim() === section.name) {
      setRenamingId(null);
      setMessage(null);
      return;
    }
    if (!begin()) return;
    try {
      const result = await renameSection(section, draft);
      if (result.status === "saved") {
        setRenamingId(null);
        setMessage(null);
        phone.changed();
        return;
      }
      setMessage(result.message);
    } finally {
      finish();
    }
  }

  async function commitDelete(section: Section) {
    if (sections.length < 2 || !begin()) return;
    try {
      const result = await deleteSection(section.id, section.listId);
      if (result.status === "saved") {
        setDeletingId(null);
        setMessage(null);
        phone.changed();
        return;
      }
      setMessage(result.message);
    } finally {
      finish();
    }
  }

  async function addSection() {
    if (!list || !begin()) return;
    try {
      const result = await createSection(list.id, sectionName);
      if (result.status === "saved") {
        setSectionName("");
        setMessage(null);
        phone.changed();
        return;
      }
      setMessage(result.message);
    } finally {
      finish();
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Title>Board</Stack.Title>
      {data === null && !error ? <Text style={{ color: colors.label }}>Loading the board…</Text> : null}
      {error && data === null ? (
        <View style={{ gap: 12 }}>
          <Text selectable style={{ color: colors.label }}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}>
            <Text style={{ color: colors.label, fontSize: 17 }}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {data && data.lists.length > 0 && list ? (
        <Choice
          label="List"
          value={list.id}
          options={data.lists.map((item) => ({ value: item.id, label: item.name }))}
          onChange={chooseList}
          disabled={pending}
        />
      ) : null}
      {data && !list ? <Text style={{ color: colors.label, fontSize: 17 }}>Choose a list.</Text> : null}
      {message ? <Text selectable style={{ color: colors.label }}>{message}</Text> : null}
      {error && data ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {list ? (
        <ScrollView
          horizontal
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 12, alignItems: "flex-start" }}
        >
          {openColumns.map((column) => {
            const section = sections.find((item) => item.id === column.id) ?? null;
            return (
              <ColumnView
                key={column.id}
                name={column.name}
                width={columnWidth}
                section={section}
                sections={sections}
                renaming={section !== null && renamingId === section.id}
                draft={draft}
                deleting={section !== null && deletingId === section.id}
                pending={pending}
                onDraft={setDraft}
                onMove={(direction) => {
                  if (section) moveColumn(section.id, direction);
                }}
                onRename={() => {
                  if (!section) return;
                  setDraft(section.name);
                  setMessage(null);
                  setDeletingId(null);
                  setRenamingId(section.id);
                }}
                onCancelRename={() => setRenamingId(null)}
                onCommitRename={() => {
                  if (section) void commitRename(section);
                }}
                onAskDelete={() => {
                  if (!section || sections.length < 2) return;
                  setRenamingId(null);
                  setDeletingId(section.id);
                }}
                onCancelDelete={() => setDeletingId(null)}
                onCommitDelete={() => {
                  if (section) void commitDelete(section);
                }}
              >
                {column.tasks.map((task, index) => (
                  <CardView
                    key={task.id}
                    task={task}
                    listColor={list.color}
                    clock={data?.clock ?? "12"}
                    tags={tagsOnCard(task.id, data?.links ?? [], data?.tags ?? [])}
                    files={(data?.files ?? []).filter((file) => file.taskId === task.id)}
                    destinations={moveDestinations(task, columns)}
                    atStart={index === 0}
                    atEnd={index === column.tasks.length - 1}
                    moving={movingId === task.id}
                    pending={pending}
                    onUp={() => moveCard(task, -1)}
                    onDown={() => moveCard(task, 1)}
                    onToggleMove={() => setMovingId((current) => (current === task.id ? null : task.id))}
                    onMoveTo={(columnId) => moveCardTo(task, columnId)}
                  />
                ))}
              </ColumnView>
            );
          })}
          <View style={{ width: columnWidth, gap: 8 }}>
            <Field label="New section" value={sectionName} onChangeText={setSectionName} maxLength={80} />
            <PrimaryButton label="Add section" disabled={pending} onPress={() => void addSection()} />
          </View>
          {done ? (
            <ColumnView name={done.name} width={columnWidth} section={null} sections={sections} pending={pending}>
              {done.tasks.map((task, index) => (
                <CardView
                  key={task.id}
                  task={task}
                  listColor={list.color}
                  clock={data?.clock ?? "12"}
                  tags={tagsOnCard(task.id, data?.links ?? [], data?.tags ?? [])}
                  files={(data?.files ?? []).filter((file) => file.taskId === task.id)}
                  destinations={moveDestinations(task, columns)}
                  atStart={index === 0}
                  atEnd={index === done.tasks.length - 1}
                  moving={movingId === task.id}
                  pending={pending}
                  onUp={() => moveCard(task, -1)}
                  onDown={() => moveCard(task, 1)}
                  onToggleMove={() => setMovingId((current) => (current === task.id ? null : task.id))}
                  onMoveTo={(columnId) => moveCardTo(task, columnId)}
                />
              ))}
            </ColumnView>
          ) : null}
        </ScrollView>
      ) : null}
    </ScrollView>
  );
}

function ColumnView({
  name,
  width,
  section,
  sections,
  renaming = false,
  draft = "",
  deleting = false,
  pending,
  onDraft,
  onMove,
  onRename,
  onCancelRename,
  onCommitRename,
  onAskDelete,
  onCancelDelete,
  onCommitDelete,
  children,
}: {
  name: string;
  width: number;
  section: Section | null;
  sections: Section[];
  renaming?: boolean;
  draft?: string;
  deleting?: boolean;
  pending: boolean;
  onDraft?: (value: string) => void;
  onMove?: (direction: -1 | 1) => void;
  onRename?: () => void;
  onCancelRename?: () => void;
  onCommitRename?: () => void;
  onAskDelete?: () => void;
  onCancelDelete?: () => void;
  onCommitDelete?: () => void;
  children: ReactNode;
}) {
  useColorScheme();
  const index = section ? sections.findIndex((item) => item.id === section.id) : -1;
  const last = sections.length < 2;
  const plan = section ? sectionDeletePlan(sections, section.id) : null;
  const target = plan && "targetId" in plan ? sections.find((item) => item.id === plan.targetId) : null;

  return (
    <View
      style={{
        width,
        gap: 10,
        backgroundColor: colors.grouped,
        borderRadius: 16,
        borderCurve: "continuous",
        padding: 12,
      }}
    >
      {section && renaming ? (
        <Field label={`Rename ${section.name}`} value={draft} onChangeText={(value) => onDraft?.(value)} maxLength={80} />
      ) : (
        <Text selectable style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{name}</Text>
      )}
      {section ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <TextButton
            label="Up"
            accessibilityLabel={`Move ${section.name} up`}
            disabled={pending || index <= 0}
            onPress={() => onMove?.(-1)}
          />
          <TextButton
            label="Down"
            accessibilityLabel={`Move ${section.name} down`}
            disabled={pending || index < 0 || index >= sections.length - 1}
            onPress={() => onMove?.(1)}
          />
          {renaming ? (
            <>
              <TextButton label="Save" accessibilityLabel={`Rename ${section.name}`} disabled={pending} onPress={() => onCommitRename?.()} />
              <TextButton label="Cancel" disabled={pending} onPress={() => onCancelRename?.()} />
            </>
          ) : (
            <TextButton label="Rename" accessibilityLabel={`Rename ${section.name}`} disabled={pending} onPress={() => onRename?.()} />
          )}
          <TextButton
            label="Delete"
            accessibilityLabel={`Delete ${section.name}`}
            disabled={pending || last || deleting}
            onPress={() => onAskDelete?.()}
          />
        </View>
      ) : null}
      {section && deleting && target ? (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.label, fontSize: 15 }}>Tasks in this section move to {target.name}.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <TextButton label="Delete" accessibilityLabel={`Delete ${section.name}`} disabled={pending} onPress={() => onCommitDelete?.()} />
            <TextButton label="Cancel" disabled={pending} onPress={() => onCancelDelete?.()} />
          </View>
        </View>
      ) : null}
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function CardView({
  task,
  listColor,
  clock,
  tags,
  files,
  destinations,
  atStart,
  atEnd,
  moving,
  pending,
  onUp,
  onDown,
  onToggleMove,
  onMoveTo,
}: {
  task: Task;
  listColor: string;
  clock: "12" | "24";
  tags: { id: string; name: string; color: string }[];
  files: BoardFile[];
  destinations: { id: string; name: string }[];
  atStart: boolean;
  atEnd: boolean;
  moving: boolean;
  pending: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggleMove: () => void;
  onMoveTo: (columnId: string) => void;
}) {
  useColorScheme();
  const facts = cardFacts(task, tags, clock);
  return (
    <View style={{ gap: 8, backgroundColor: colors.background, borderRadius: 12, borderCurve: "continuous", padding: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <View style={{ width: 10, height: 10, marginTop: 6, borderRadius: 5, backgroundColor: listColor }} />
        <Link href={{ pathname: "/task/[id]", params: { id: task.id } }} asChild>
          <Pressable style={{ flex: 1 }}>
            <Text selectable style={{ color: colors.label, fontSize: 17 }}>{task.title}</Text>
          </Pressable>
        </Link>
      </View>
      {facts.priority || facts.due || facts.time || facts.checklist || facts.tag ? (
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14, fontVariant: ["tabular-nums"] }}>
          {[
            facts.priority ? PRIORITY_WORD[facts.priority] : null,
            facts.due,
            facts.time,
            facts.checklist ? `${facts.checklist.done}/${facts.checklist.total}` : null,
            facts.tag ? (facts.tag.extra > 0 ? `${facts.tag.name} +${facts.tag.extra}` : facts.tag.name) : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </Text>
      ) : null}
      {files.map((file) => (
        <Text key={file.id} selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
          {file.fileName}
          {"\n"}
          {FILE_ON_COMPUTER}
        </Text>
      ))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <TextButton label="Up" accessibilityLabel={`Move ${task.title} up`} disabled={pending || atStart} onPress={onUp} />
        <TextButton label="Down" accessibilityLabel={`Move ${task.title} down`} disabled={pending || atEnd} onPress={onDown} />
        <TextButton label="Move" accessibilityLabel={`Move ${task.title}`} disabled={pending || destinations.length === 0} onPress={onToggleMove} />
      </View>
      {moving ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {destinations.map((column) => (
            <TextButton
              key={column.id}
              label={column.name}
              accessibilityLabel={`Move ${task.title} to ${column.name}`}
              disabled={pending}
              onPress={() => onMoveTo(column.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TextButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  useColorScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: colors.separator,
        borderRadius: 10,
        borderCurve: "continuous",
        paddingHorizontal: 10,
        paddingVertical: 6,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: colors.label, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function Centered({ text }: { text: string }) {
  useColorScheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: "center" }}>
      <Text selectable style={{ color: colors.label, fontSize: 17 }}>{text}</Text>
    </View>
  );
}
