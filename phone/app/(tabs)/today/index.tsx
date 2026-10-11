import { DateStepper } from "@/components/date-stepper";
import { DayRecord } from "@/components/day-record";
import { HeaderAdd } from "@/components/header-add";
import { HeaderSearch } from "@/components/header-search";
import { MonthGrid } from "@/components/month-grid";
import { TaskRow } from "@/components/task-row";
import { TextButton } from "@/components/text-button";
import { tasksForDate, type TodayTask } from "@/db/tasks";
import { usePhone, type LinkStatus } from "@/state/phone";
import { colors, ink } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { addDays, formatDay, groupTasksForDay, todayIso } from "@layp/shared";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, useColorScheme, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

export default function TodayScreen() {
  useColorScheme();
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const today = todayIso();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const [date, setDate] = useState(today);
  const [picker, setPicker] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const raw = Array.isArray(params.date) ? params.date[0] : params.date;
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) setDate(raw);
  }, [params.date]);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancelled = false;
    void tasksForDate(date, today).then(
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
  }, [phone.ready, phone.hasKey, phone.revision, retry, date, today]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;

  const groups = tasks ? groupTasksForDay(tasks, date, today) : null;
  const openCount = groups ? groups.pinned.length + groups.overdue.length + groups.scheduled.length : 0;
  const empty = groups !== null && openCount === 0;

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
      <LaypTitle>Today</LaypTitle>
      <HeaderSearch />
      <HeaderAdd day={date} />
      <DateStepper
        label={formatDay(date)}
        onLabelPress={() => setPicker((open) => !open)}
        onPrevious={() => setDate((current) => addDays(current, -1))}
        onNext={() => setDate((current) => addDays(current, 1))}
        onToday={() => setDate(today)}
      />
      {picker ? (
        <MonthGrid
          value={date}
          weekStart={settings.weekStart}
          onPick={(iso) => {
            setDate(iso);
            setPicker(false);
          }}
        />
      ) : null}
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
      {empty ? <Text style={{ color: colors.label, fontSize: 17 }}>Nothing scheduled.</Text> : null}
      {groups ? (
        <View style={{ gap: 8 }}>
          <Group title="Pinned" tasks={groups.pinned} onComplete={(id) => void finish(id)} />
          <Group title="Overdue" tasks={groups.overdue} onComplete={(id) => void finish(id)} />
          <Group title="" tasks={groups.scheduled} onComplete={(id) => void finish(id)} />
          {groups.completed.length > 0 ? (
            <View style={{ gap: 4 }}>
              <TextButton
                label={completedOpen ? `Hide completed ${groups.completed.length}` : `Completed ${groups.completed.length}`}
                onPress={() => setCompletedOpen((value) => !value)}
              />
              {completedOpen ? <Group title="" tasks={groups.completed} onComplete={() => undefined} /> : null}
            </View>
          ) : null}
        </View>
      ) : null}
      <DayRecord date={date} onSaved={phone.changed} revision={phone.revision} />
      {error && tasks !== null ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
    </ScrollView>
  );
}

function Group({ title, tasks, onComplete }: { title: string; tasks: TodayTask[]; onComplete: (id: string) => void }) {
  useColorScheme();
  usePaper();
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
  usePaper();
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
  usePaper();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: "center" }}>
      <Text selectable style={{ color: colors.label, fontSize: 17 }}>{text}</Text>
    </View>
  );
}
