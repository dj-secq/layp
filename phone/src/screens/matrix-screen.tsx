import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import { loadLists } from "@/db/lists";
import { tasksOpen } from "@/db/queries";
import { patchTask } from "@/db/tasks";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import type { Task, TaskList } from "@layp/shared";
import { Redirect, Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

const QUADRANTS = [
  { title: "Important and urgent", important: true, urgent: true },
  { title: "Important", important: true, urgent: false },
  { title: "Urgent", important: false, urgent: true },
  { title: "Neither", important: false, urgent: false },
] as const;

export function MatrixScreen() {
  usePaper();
  const phone = usePhone();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState<(typeof QUADRANTS)[number] | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void Promise.all([tasksOpen(), loadLists()]).then(
      ([rows, nextLists]) => {
        if (cancel) return;
        setTasks(rows);
        setLists(nextLists);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load the matrix.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && tasks === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  async function place(task: Task, important: boolean, urgent: boolean) {
    if (task.important === important && task.urgent === urgent) {
      setMenuId(null);
      return;
    }
    const result = await patchTask(task, { important, urgent });
    if (result.status === "saved") {
      setMenuId(null);
      phone.changed();
      return;
    }
    setError(result.status === "error" ? result.message : "Not saved");
  }

  const cards = (quadrant: (typeof QUADRANTS)[number]) =>
    (tasks ?? []).filter((task) => task.important === quadrant.important && task.urgent === quadrant.urgent);

  return (
    <ScreenScroll>
      <Stack.Title>Matrix</Stack.Title>
      {tasks === null ? <Text style={{ color: colors.label }}>Loading the matrix…</Text> : null}
      {error && tasks !== null ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {open ? <TextButton label="All quadrants" onPress={() => setOpen(null)} /> : null}
      {tasks !== null && !open ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {QUADRANTS.map((quadrant) => {
            const rows = cards(quadrant);
            return (
              <Pressable
                key={quadrant.title}
                accessibilityRole="button"
                onPress={() => setOpen(quadrant)}
                style={{ width: "48%", minHeight: 140, backgroundColor: colors.grouped, borderRadius: 10, padding: 12, gap: 6 }}
              >
                <Text style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>{quadrant.title}</Text>
                <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{rows.length}</Text>
                {rows.slice(0, 3).map((task) => (
                  <Text key={task.id} numberOfLines={1} style={{ color: colors.label, fontSize: 15 }}>
                    {task.title}
                  </Text>
                ))}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {tasks !== null && open ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.label, fontSize: 20, fontWeight: "600" }}>{open.title}</Text>
          {cards(open).map((task) => (
            <View key={task.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: lists.find((list) => list.id === task.listId)?.color ?? colors.label }} />
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })} style={{ flex: 1, minHeight: 40, justifyContent: "center" }}>
                  <Text style={{ color: colors.label, fontSize: 17 }}>{task.title}</Text>
                </Pressable>
                <TextButton label="Menu" onPress={() => setMenuId((current) => (current === task.id ? null : task.id))} />
              </View>
              {menuId === task.id ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {QUADRANTS.map((quadrant) => (
                    <TextButton key={quadrant.title} label={quadrant.title} onPress={() => void place(task, quadrant.important, quadrant.urgent)} />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </ScreenScroll>
  );
}
