import { HeaderAdd } from "@/components/header-add";
import { Centered, ScreenScroll } from "@/components/screen";
import { TaskRow } from "@/components/task-row";
import { tasksUpcoming } from "@/db/queries";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { addDays, formatDay, todayIso, type Task } from "@layp/shared";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

export function UpcomingScreen() {
  usePaper();
  const phone = usePhone();
  const today = todayIso();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void tasksUpcoming(today).then(
      (rows) => {
        if (cancel) return;
        setTasks(rows);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load upcoming.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry, today]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && tasks === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  const overdue = (tasks ?? []).filter((task) => task.dueOn && task.dueOn < today);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(today, index + 1));
  const visible = overdue.length + dates.filter((date) => (tasks ?? []).some((task) => task.dueOn === date)).length;

  async function toggle(task: Task) {
    const result = task.completedAt ? await phone.reopen(task.id) : await phone.complete(task.id);
    if (result === "error") setError("Not saved");
  }

  return (
    <ScreenScroll>
      <LaypTitle>Upcoming</LaypTitle>
      <HeaderAdd />
      {tasks === null ? <Text style={{ color: colors.label }}>Loading upcoming…</Text> : null}
      {error && tasks !== null ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {tasks !== null && visible === 0 ? <Text style={{ color: colors.label, fontSize: 17 }}>Nothing scheduled.</Text> : null}
      {tasks !== null && overdue.length > 0 ? <Group label="Overdue" tasks={overdue} onToggle={toggle} /> : null}
      {tasks !== null
        ? dates.map((date) => {
            const rows = tasks.filter((task) => task.dueOn === date);
            if (rows.length === 0) return null;
            return <Group key={date} label={formatDay(date)} tasks={rows} onToggle={toggle} />;
          })
        : null}
    </ScreenScroll>
  );
}

function Group({ label, tasks, onToggle }: { label: string; tasks: Task[]; onToggle: (task: Task) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} canReopen onComplete={() => void onToggle(task)} />
      ))}
    </View>
  );
}
