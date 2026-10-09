import { DayRecord } from "@/components/day-record";
import { TaskRow } from "@/components/task-row";
import { tasksForDate, type TodayTask } from "@/db/tasks";
import { usePhone, type LinkStatus } from "@/state/phone";
import { colors, ink } from "@/theme/colors";
import { formatDay, groupTasksForDay, todayIso } from "@layp/shared";
import { Link, Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, useColorScheme, View } from "react-native";

export default function TodayScreen() {
  useColorScheme();
  const phone = usePhone();
  const today = todayIso();
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancelled = false;
    void tasksForDate(today, today).then(
      (rows) => {
        if (cancelled) return;
        setTasks(rows);
        setError(null);
      },
      () => {
        if (!cancelled) setError("Could not load today.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry, today]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;

  const groups = tasks ? groupTasksForDay(tasks, today, today) : null;
  const openCount = groups ? groups.pinned.length + groups.overdue.length + groups.scheduled.length : 0;
  const empty = groups !== null && openCount === 0 && groups.completed.length === 0;

  function finish(id: string) {
    void phone.complete(id).then((result) => {
      if (result === "error") setError("Not saved");
    });
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Title>Today</Stack.Title>
      <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16 }}>{formatDay(today)}</Text>
      <StatusLine status={phone.status} />
      {tasks === null && !error ? <Text style={{ color: colors.label }}>Loading today…</Text> : null}
      {error && tasks === null ? (
        <View style={{ gap: 12 }}>
          <Text selectable style={{ color: colors.label }}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}>
            <Text style={{ color: colors.label, fontSize: 17 }}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {empty ? <Text style={{ color: colors.label, fontSize: 17 }}>Nothing open today.</Text> : null}
      {groups ? (
        <View style={{ gap: 8 }}>
          <Group title="Pinned" tasks={groups.pinned} onComplete={(id) => void finish(id)} />
          <Group title="Overdue" tasks={groups.overdue} onComplete={(id) => void finish(id)} />
          <Group title="" tasks={groups.scheduled} onComplete={(id) => void finish(id)} />
          <Group title="Completed" tasks={groups.completed} onComplete={() => undefined} />
        </View>
      ) : null}
      <DayRecord date={today} onSaved={phone.changed} />
      {error && tasks !== null ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      <Link href="/inbox">
        <Text style={{ color: colors.label, fontSize: 17 }}>Inbox</Text>
      </Link>
      <Link href="/board">
        <Text style={{ color: colors.label, fontSize: 17 }}>Board</Text>
      </Link>
      <Link href={{ pathname: "/", params: { address: "1" } }}>
        <Text style={{ color: colors.label, fontSize: 17 }}>Computer address</Text>
      </Link>
      <Pressable
        accessibilityRole="button"
        onPress={() => void phone.forget()}
        style={{
          borderRadius: 14,
          borderCurve: "continuous",
          paddingVertical: 14,
          alignItems: "center",
          backgroundColor: colors.grouped,
        }}
      >
        <Text style={{ color: colors.label, fontSize: 17 }}>Forget this phone</Text>
      </Pressable>
    </ScrollView>
  );
}

function Group({ title, tasks, onComplete }: { title: string; tasks: TodayTask[]; onComplete: (id: string) => void }) {
  useColorScheme();
  if (tasks.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      {title ? <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{title}</Text> : null}
      <View style={{ backgroundColor: colors.grouped, borderRadius: 16, borderCurve: "continuous", paddingHorizontal: 12 }}>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onComplete={onComplete} />
        ))}
      </View>
    </View>
  );
}

function StatusLine({ status }: { status: LinkStatus }) {
  useColorScheme();
  if (!status) return null;
  const text = status.kind === "ok" ? status.at : status.message;
  return (
    <Text selectable style={{ color: status.kind === "down" ? ink : colors.secondaryLabel, fontSize: 15 }}>
      {text}
    </Text>
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
