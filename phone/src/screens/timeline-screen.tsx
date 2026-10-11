import { Centered, ScreenScroll } from "@/components/screen";
import { loadLists } from "@/db/lists";
import { tasksForTimeline } from "@/db/queries";
import { usePhone } from "@/state/phone";
import { colors, onPrimary, primary } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { formatShortDay, timelineDays, timelineGroups, timelineRanges, todayIso, type Task, type TaskList, type TimelineRange } from "@layp/shared";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

const RANGE_LABELS: Record<TimelineRange, string> = {
  "2w": "2 weeks",
  "6w": "6 weeks",
  "3m": "3 months",
};

export function TimelineScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const today = todayIso();
  const [range, setRange] = useState<TimelineRange>("6w");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void Promise.all([tasksForTimeline(), loadLists()]).then(
      ([rows, nextLists]) => {
        if (cancel) return;
        setTasks(rows);
        setLists(nextLists);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load the timeline.");
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

  const days = timelineDays(today, range, settings.weekStart);
  const groups = timelineGroups(tasks ?? [], lists.map((list) => list.id), days[0], days[days.length - 1]);

  function indexOf(day: string): number {
    if (days.length === 0) return 0;
    if (day <= days[0]) return 0;
    if (day >= days[days.length - 1]) return days.length - 1;
    const found = days.indexOf(day);
    return found < 0 ? 0 : found;
  }

  return (
    <ScreenScroll>
      <LaypTitle>Timeline</LaypTitle>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {timelineRanges.map((id) => {
          const selected = range === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setRange(id)}
              style={{ backgroundColor: selected ? primary : colors.grouped, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: selected ? onPrimary : colors.label, fontSize: 16 }}>{RANGE_LABELS[id]}</Text>
            </Pressable>
          );
        })}
      </View>
      {tasks === null ? <Text style={{ color: colors.label }}>Loading the timeline…</Text> : null}
      {tasks !== null && groups.length === 0 ? <Text style={{ color: colors.label, fontSize: 17 }}>Tasks with a date show up here.</Text> : null}
      {groups.map((group) => {
        const list = lists.find((item) => item.id === group.listId);
        return (
          <View key={group.listId} style={{ gap: 8 }}>
            <Text style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>{list?.name ?? "List"}</Text>
            {group.rows.map((row) => {
              const task = row.task;
              const start = task.startOn && task.dueOn ? task.startOn : (task.dueOn ?? task.startOn ?? days[0]);
              const end = task.startOn && task.dueOn ? task.dueOn : start;
              const startIndex = Math.max(0, indexOf(start) < 0 ? 0 : indexOf(start));
              const endFound = indexOf(end);
              const endIndex = endFound < 0 ? days.length - 1 : Math.min(days.length - 1, endFound);
              const span = Math.max(1, endIndex - startIndex + 1);
              return (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
                  style={{ gap: 6, paddingLeft: row.depth * 12 }}
                >
                  <Text style={{ color: colors.label, fontSize: 17 }}>{task.title}</Text>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {formatShortDay(start)} – {formatShortDay(end)}
                  </Text>
                  {row.bar ? (
                    <View style={{ height: 8, borderRadius: 4, width: `${(span / days.length) * 100}%`, backgroundColor: list?.color ?? primary }} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </ScreenScroll>
  );
}
