import { Choice } from "@/components/choice";
import { Field } from "@/components/field";
import { HeaderAdd } from "@/components/header-add";
import { PrimaryButton } from "@/components/primary-button";
import { Centered, ScreenScroll } from "@/components/screen";
import { TaskRow } from "@/components/task-row";
import { TextButton } from "@/components/text-button";
import { sectionDeletePlan } from "@/db/board";
import {
  compareSections,
  createSection,
  deleteSection,
  firstSectionId,
  loadLists,
  loadSections,
  renameSection,
  reorderSections,
} from "@/db/lists";
import { tasksForList } from "@/db/queries";
import { addQuick, createTask, rewriteOrder } from "@/db/tasks";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { movedIds, sortTasks, todayIso, type Section, type Task, type TaskList, type TaskSort } from "@layp/shared";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

const sortChoice = new Map<string, TaskSort>();

const SORTS: { value: TaskSort; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "created", label: "Created" },
];

export function ListScreen({ listId, quickAdd = false }: { listId: string; quickAdd?: boolean }) {
  usePaper();
  const phone = usePhone();
  const [list, setList] = useState<TaskList | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [sortMode, setSortMode] = useState<TaskSort>(sortChoice.get(listId) ?? "manual");
  const [completedOpen, setCompletedOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [quick, setQuick] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSortMode(sortChoice.get(listId) ?? "manual");
  }, [listId]);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void Promise.all([loadLists(), loadSections(), tasksForList(listId)]).then(
      ([lists, allSections, rows]) => {
        if (cancel) return;
        const found = lists.find((item) => item.id === listId) ?? null;
        setList(found);
        setMissing(found === null);
        setSections(allSections.filter((section) => section.listId === listId).sort(compareSections));
        setTasks(rows);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load the list.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, listId, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && tasks === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;
  if (missing) return <Centered text="That list is not here." />;

  const open = (tasks ?? []).filter((task) => task.completedAt === null);
  const completed = (tasks ?? []).filter((task) => task.completedAt !== null);
  const ordered = sections;

  function tasksIn(section: Section, index: number): Task[] {
    return sortTasks(
      open.filter((task) => {
        if (task.sectionId === section.id) return true;
        if (index !== 0) return false;
        return !ordered.some((item) => item.id === task.sectionId);
      }),
      sortMode,
    );
  }

  async function toggle(task: Task) {
    const result = task.completedAt ? await phone.reopen(task.id) : await phone.complete(task.id);
    if (result === "error") setNotice("Not saved");
    else if (!task.completedAt) setCompletedOpen(true);
  }

  async function addTitle() {
    setPending(true);
    const result = await createTask({
      title,
      listId,
      sectionId: firstSectionId(sections, listId),
    });
    setPending(false);
    if (result.status === "saved") {
      setTitle("");
      setNotice(null);
      phone.changed();
      return;
    }
    setNotice(result.status === "error" ? result.message : "Not saved");
  }

  async function addLine() {
    const now = new Date();
    setPending(true);
    const result = await addQuick(
      quick,
      { today: todayIso(), minutes: now.getHours() * 60 + now.getMinutes() },
      { listId },
    );
    setPending(false);
    if (result.status === "empty") return;
    if (result.status === "saved") {
      setQuick("");
      setNotice(result.notice);
      phone.changed();
      return;
    }
    setNotice(result.message);
  }

  async function addSection() {
    const result = await createSection(listId, sectionName);
    if (result.status === "saved") {
      setSectionName("");
      setNotice(null);
      phone.changed();
      return;
    }
    setNotice(result.message);
  }

  async function moveTasks(ids: string[], id: string, direction: -1 | 1) {
    const next = movedIds(ids, id, direction);
    if (!next) return;
    const result = await rewriteOrder(next);
    if (result === "error") setNotice("Not saved");
    else phone.changed();
  }

  return (
    <ScreenScroll>
      <LaypTitle>{list?.name ?? "List"}</LaypTitle>
      <HeaderAdd listId={listId} />
      {tasks === null ? <Text style={{ color: colors.label }}>Loading the list…</Text> : null}
      {quickAdd ? (
        <View style={{ gap: 8 }}>
          <Field label="Quick add" value={quick} onChangeText={setQuick} placeholder="gym friday 6pm" autoCapitalize="none" />
          <PrimaryButton label={pending ? "Saving…" : "Add"} disabled={pending} onPress={() => void addLine()} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Field label="Add a task" value={title} onChangeText={setTitle} placeholder="Add a task" />
          <PrimaryButton label={pending ? "Saving…" : "Add"} disabled={pending} onPress={() => void addTitle()} />
        </View>
      )}
      <Choice
        label="Sort"
        value={sortMode}
        options={SORTS}
        onChange={(mode) => {
          const next = mode as TaskSort;
          sortChoice.set(listId, next);
          setSortMode(next);
        }}
      />
      {notice ? <Text selectable style={{ color: colors.label }}>{notice}</Text> : null}
      {tasks !== null && open.length === 0 ? <Text style={{ color: colors.label, fontSize: 17 }}>Add a task.</Text> : null}
      {tasks !== null
        ? ordered.map((section, index) => (
            <SectionBlock
              key={section.id}
              section={section}
              sections={ordered}
              tasks={tasksIn(section, index)}
              sortMode={sortMode}
              onToggle={(task) => void toggle(task)}
              onMove={(id, direction, ids) => void moveTasks(ids, id, direction)}
              onChanged={() => phone.changed()}
              onError={setNotice}
            />
          ))
        : null}
      {tasks !== null && ordered.length === 0 && open.length > 0 ? (
        <TaskListBlock
          tasks={sortTasks(open, sortMode)}
          sortMode={sortMode}
          onToggle={(task) => void toggle(task)}
          onMove={(id, direction, ids) => void moveTasks(ids, id, direction)}
        />
      ) : null}
      <View style={{ gap: 8 }}>
        <Field label="New section" value={sectionName} onChangeText={setSectionName} placeholder="New section" maxLength={80} />
        <TextButton label="Add section" onPress={() => void addSection()} />
      </View>
      {tasks !== null && completed.length > 0 ? (
        <View style={{ gap: 8 }}>
          <TextButton
            label={completedOpen ? `Hide completed ${completed.length}` : `Completed ${completed.length}`}
            onPress={() => setCompletedOpen((value) => !value)}
          />
          {completedOpen
            ? completed.map((task) => (
                <TaskRow key={task.id} task={task} canReopen onComplete={() => void toggle(task)} />
              ))
            : null}
        </View>
      ) : null}
    </ScreenScroll>
  );
}

function TaskListBlock({
  tasks,
  sortMode,
  onToggle,
  onMove,
}: {
  tasks: Task[];
  sortMode: TaskSort;
  onToggle: (task: Task) => void;
  onMove: (id: string, direction: -1 | 1, ids: string[]) => void;
}) {
  const ids = tasks.map((task) => task.id);
  return (
    <View>
      {tasks.map((task, index) => (
        <View key={task.id} style={{ gap: 4 }}>
          <TaskRow task={task} onComplete={() => onToggle(task)} />
          {sortMode === "manual" ? (
            <View style={{ flexDirection: "row" }}>
              <TextButton label="Up" disabled={index === 0} onPress={() => onMove(task.id, -1, ids)} />
              <TextButton label="Down" disabled={index === ids.length - 1} onPress={() => onMove(task.id, 1, ids)} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function SectionBlock({
  section,
  sections,
  tasks,
  sortMode,
  onToggle,
  onMove,
  onChanged,
  onError,
}: {
  section: Section;
  sections: Section[];
  tasks: Task[];
  sortMode: TaskSort;
  onToggle: (task: Task) => void;
  onMove: (id: string, direction: -1 | 1, ids: string[]) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const index = sections.findIndex((item) => item.id === section.id);
  const last = sections.length < 2;
  const plan = sectionDeletePlan(sections, section.id);
  const target = "targetId" in plan ? sections.find((item) => item.id === plan.targetId) : null;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const [deleting, setDeleting] = useState(false);

  async function commitRename() {
    if (draft.trim() === section.name) {
      setRenaming(false);
      return;
    }
    const result = await renameSection(section, draft);
    if (result.status !== "saved") {
      onError(result.message);
      return;
    }
    setRenaming(false);
    onChanged();
  }

  async function move(direction: -1 | 1) {
    const next = movedIds(
      sections.map((item) => item.id),
      section.id,
      direction,
    );
    if (!next) return;
    const result = await reorderSections(next);
    if (result === "error") onError("Not saved");
    else onChanged();
  }

  async function remove() {
    const result = await deleteSection(section.id, section.listId);
    if (result.status !== "saved") {
      onError(result.message);
      return;
    }
    setDeleting(false);
    onChanged();
  }

  return (
    <View style={{ gap: 8 }}>
      {renaming ? (
        <View style={{ gap: 8 }}>
          <Field label={`Rename ${section.name}`} value={draft} onChangeText={setDraft} maxLength={80} />
          <View style={{ flexDirection: "row" }}>
            <TextButton label="Save" onPress={() => void commitRename()} />
            <TextButton
              label="Cancel"
              onPress={() => {
                setDraft(section.name);
                setRenaming(false);
              }}
            />
          </View>
        </View>
      ) : (
        <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>{section.name}</Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <TextButton label="Up" disabled={index <= 0} onPress={() => void move(-1)} />
        <TextButton label="Down" disabled={index < 0 || index >= sections.length - 1} onPress={() => void move(1)} />
        <TextButton label="Rename" onPress={() => setRenaming(true)} />
        <TextButton label="Delete" disabled={last} onPress={() => setDeleting(true)} />
      </View>
      {deleting && target ? (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.label }}>Tasks in this section move to {target.name}.</Text>
          <View style={{ flexDirection: "row" }}>
            <TextButton label="Delete" onPress={() => void remove()} />
            <TextButton label="Cancel" onPress={() => setDeleting(false)} />
          </View>
        </View>
      ) : null}
      <TaskListBlock tasks={tasks} sortMode={sortMode} onToggle={onToggle} onMove={onMove} />
    </View>
  );
}
