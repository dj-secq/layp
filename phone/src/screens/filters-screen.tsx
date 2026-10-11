import { Centered, ScreenScroll } from "@/components/screen";
import { Choice } from "@/components/choice";
import { DateField } from "@/components/date-field";
import { Field } from "@/components/field";
import { PrimaryButton } from "@/components/primary-button";
import { TaskRow } from "@/components/task-row";
import { TextButton } from "@/components/text-button";
import { createFilter, deleteFilter, loadFilters, reorderFilters, updateFilter, type SavedFilter } from "@/db/filters";
import { loadLists } from "@/db/lists";
import { tasksForPlanner } from "@/db/queries";
import { loadTags, taskTagLinks } from "@/db/tags";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { emptyRule, matchFilter, movedIds, sortTasks, todayIso, type FilterRule, type Priority, type Tag, type Task, type TaskList } from "@layp/shared";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

export function FiltersScreen() {
  usePaper();
  const phone = usePhone();
  const [filters, setFilters] = useState<SavedFilter[] | null>(null);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [editor, setEditor] = useState<SavedFilter | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void Promise.all([loadFilters(), loadLists(), loadTags()]).then(
      ([rows, nextLists, nextTags]) => {
        if (cancel) return;
        setFilters(rows);
        setLists(nextLists);
        setTags(nextTags);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load filters.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && filters === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  const editing = editor === "new" ? null : editor;

  async function move(id: string, direction: -1 | 1) {
    const next = movedIds((filters ?? []).map((filter) => filter.id), id, direction);
    if (!next) return;
    await reorderFilters(next);
    phone.changed();
  }

  async function remove(id: string) {
    const result = await deleteFilter(id);
    if (result.status === "saved") phone.changed();
    else setError(result.message);
  }

  return (
    <ScreenScroll>
      <LaypTitle>Filters</LaypTitle>
      <TextButton label={editor ? "Close" : "New filter"} onPress={() => setEditor(editor ? null : "new")} />
      {editor ? (
        <FilterForm
          initial={editing}
          lists={lists}
          tags={tags}
          onCancel={() => setEditor(null)}
          onSaved={(row, created) => {
            setEditor(null);
            phone.changed();
            if (created) router.push({ pathname: "/more/filter/[id]", params: { id: row.id } });
          }}
        />
      ) : null}
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {filters === null ? <Text style={{ color: colors.label }}>Loading filters…</Text> : null}
      {filters?.length === 0 ? <Text style={{ color: colors.label, fontSize: 16 }}>No filters yet.</Text> : null}
      {(filters ?? []).map((filter, index) => (
        <View key={filter.id} style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/more/filter/[id]", params: { id: filter.id } })}>
            <Text style={{ color: colors.label, fontSize: 17 }}>{filter.name}</Text>
          </Pressable>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <TextButton label="Edit" onPress={() => setEditor(filter)} />
            <TextButton label="Up" disabled={index === 0} onPress={() => void move(filter.id, -1)} />
            <TextButton label="Down" disabled={index === (filters?.length ?? 0) - 1} onPress={() => void move(filter.id, 1)} />
            <TextButton label="Delete" onPress={() => void remove(filter.id)} />
          </View>
        </View>
      ))}
    </ScreenScroll>
  );
}

export function FilterTasksScreen() {
  usePaper();
  const phone = usePhone();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [name, setName] = useState("Filter");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey || !id) return;
    let cancel = false;
    const today = todayIso();
    void Promise.all([loadFilters(), tasksForPlanner(), taskTagLinks()]).then(
      ([filters, rows, links]) => {
        if (cancel) return;
        const current = filters.find((filter) => filter.id === id) ?? null;
        if (!current) {
          setMissing(true);
          setTasks([]);
          return;
        }
        const tags = new Map<string, string[]>();
        for (const link of links) {
          const list = tags.get(link.taskId) ?? [];
          list.push(link.tagId);
          tags.set(link.taskId, list);
        }
        const matched = rows.filter((task) =>
          matchFilter(
            {
              listId: task.listId,
              priority: task.priority,
              dueOn: task.dueOn,
              completedAt: task.completedAt,
              important: task.important,
              urgent: task.urgent,
              tagIds: tags.get(task.id) ?? [],
            },
            current.rule,
            today,
          ),
        );
        setName(current.name);
        setTasks(sortTasks(matched, "due"));
        setMissing(false);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load the filter.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, id, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (missing) return <Centered text="That filter is not here." />;
  if (error && tasks === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  return (
    <ScreenScroll>
      <LaypTitle>{name}</LaypTitle>
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {tasks === null ? <Text style={{ color: colors.label }}>Loading the filter…</Text> : null}
      {tasks?.length === 0 ? <Text style={{ color: colors.label, fontSize: 16 }}>Nothing matches.</Text> : null}
      {(tasks ?? []).map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          canReopen
          onComplete={(taskId) => void (task.completedAt ? phone.reopen(taskId) : phone.complete(taskId))}
        />
      ))}
    </ScreenScroll>
  );
}

function FilterForm({
  initial,
  lists,
  tags,
  onCancel,
  onSaved,
}: {
  initial: SavedFilter | null;
  lists: TaskList[];
  tags: Tag[];
  onCancel: () => void;
  onSaved: (row: SavedFilter, created: boolean) => void;
}) {
  const settings = usePhoneSettings();
  const [name, setName] = useState(initial?.name ?? "");
  const [rule, setRule] = useState<FilterRule>(() => (initial ? { ...initial.rule } : emptyRule()));
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const result = initial ? await updateFilter(initial, name, rule) : await createFilter(name, rule);
    if (result.status !== "saved") {
      setError(result.message);
      return;
    }
    onSaved(result.row, initial === null);
  }

  return (
    <View style={{ gap: 12 }}>
      <Field label="Name" value={name} maxLength={80} onChangeText={setName} />
      <Choice
        label="List"
        value={rule.listId ?? ""}
        options={[{ value: "", label: "Any list" }, ...lists.map((list) => ({ value: list.id, label: list.name }))]}
        onChange={(listId) => setRule({ ...rule, listId: listId || null, listNot: listId ? rule.listNot : false })}
      />
      <TextButton
        label={rule.listNot ? "Is not this list" : "Is this list"}
        disabled={!rule.listId}
        onPress={() => setRule({ ...rule, listNot: !rule.listNot })}
      />
      <Choice
        label="Tag"
        value={rule.tagId ?? ""}
        options={[{ value: "", label: "Any tag" }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
        onChange={(tagId) => setRule({ ...rule, tagId: tagId || null })}
      />
      <Choice
        label="Priority"
        value={rule.priority ?? ""}
        options={[
          { value: "", label: "Any priority" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
          { value: "none", label: "None" },
        ]}
        onChange={(value) => setRule({ ...rule, priority: value ? (value as Priority) : null })}
      />
      <Choice
        label="Due"
        value={rule.due}
        options={[
          { value: "any", label: "Any date" },
          { value: "overdue", label: "Overdue" },
          { value: "today", label: "Today" },
          { value: "next7", label: "Next 7 days" },
          { value: "none", label: "No date" },
          { value: "range", label: "Date range" },
        ]}
        onChange={(due) => setRule({ ...rule, due: due as FilterRule["due"] })}
      />
      {rule.due === "range" ? (
        <View style={{ gap: 8 }}>
          <DateField label="From" value={rule.dueFrom ?? ""} weekStart={settings.weekStart} onChange={(dueFrom) => setRule({ ...rule, dueFrom: dueFrom || null })} />
          <DateField label="To" value={rule.dueTo ?? ""} weekStart={settings.weekStart} onChange={(dueTo) => setRule({ ...rule, dueTo: dueTo || null })} />
        </View>
      ) : null}
      <Choice
        label="Completed"
        value={rule.completed}
        options={[
          { value: "open", label: "Open" },
          { value: "completed", label: "Completed" },
          { value: "any", label: "Any" },
        ]}
        onChange={(completed) => setRule({ ...rule, completed: completed as FilterRule["completed"] })}
      />
      <Choice
        label="Important"
        value={flagValue(rule.important)}
        options={[
          { value: "any", label: "Any" },
          { value: "yes", label: "Important" },
          { value: "no", label: "Not important" },
        ]}
        onChange={(value) => setRule({ ...rule, important: flagFrom(value) })}
      />
      <Choice
        label="Urgent"
        value={flagValue(rule.urgent)}
        options={[
          { value: "any", label: "Any" },
          { value: "yes", label: "Urgent" },
          { value: "no", label: "Not urgent" },
        ]}
        onChange={(value) => setRule({ ...rule, urgent: flagFrom(value) })}
      />
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      <PrimaryButton label={initial ? "Save filter" : "Create filter"} onPress={() => void save()} />
      <TextButton label="Cancel" onPress={onCancel} />
    </View>
  );
}

function flagValue(value: boolean | null): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "any";
}

function flagFrom(value: string): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}
