import { DateStepper } from "@/components/date-stepper";
import { HeaderAdd } from "@/components/header-add";
import { MonthGrid } from "@/components/month-grid";
import { Centered, ScreenScroll } from "@/components/screen";
import { TaskRow } from "@/components/task-row";
import { loadLists } from "@/db/lists";
import { tasksInRange } from "@/db/queries";
import { usePhone } from "@/state/phone";
import { colors, ink, onPrimary, primary } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import {
  addDays,
  formatClock,
  formatDay,
  monthCells,
  monthLabel,
  shiftMonth,
  todayIso,
  weekBounds,
  type ClockPreference,
  type Task,
  type TaskList,
  type WeekStart,
} from "@layp/shared";
import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

type Mode = "month" | "week" | "day" | "agenda";

const MODES: { id: Mode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "agenda", label: "Agenda" },
];

export function CalendarScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const today = todayIso();
  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState(today);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const range = visibleRange(mode, anchor, settings.weekStart);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void Promise.all([tasksInRange(range.from, range.to), loadLists()]).then(
      ([rows, nextLists]) => {
        if (cancel) return;
        setTasks(rows);
        setLists(nextLists);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load the calendar.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, range.from, range.to, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && tasks === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  function shift(delta: number) {
    if (mode === "month" || mode === "agenda") {
      const next = shiftMonth(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), delta);
      setAnchor(`${next.year}-${String(next.month).padStart(2, "0")}-01`);
      return;
    }
    setAnchor(addDays(anchor, mode === "week" ? delta * 7 : delta));
  }

  const marks: Record<string, string[]> = {};
  for (const task of tasks ?? []) {
    if (!task.dueOn) continue;
    const color = lists.find((list) => list.id === task.listId)?.color ?? primary;
    const current = marks[task.dueOn] ?? [];
    if (!current.includes(color)) current.push(color);
    marks[task.dueOn] = current;
  }

  return (
    <ScreenScroll>
      <Stack.Title>Calendar</Stack.Title>
      <HeaderAdd day={anchor} />
      <DateStepper
        label={range.label}
        onPrevious={() => shift(-1)}
        onNext={() => shift(1)}
        onToday={() => setAnchor(today)}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {MODES.map((item) => {
          const selected = mode === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setMode(item.id)}
              style={{
                backgroundColor: selected ? primary : colors.grouped,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: selected ? onPrimary : colors.label, fontSize: 16 }}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {tasks === null ? <Text style={{ color: colors.label }}>Loading the calendar…</Text> : null}
      {tasks !== null && mode === "month" ? (
        <View style={{ gap: 16 }}>
          <MonthGrid value={anchor} weekStart={settings.weekStart} marks={marks} onPick={setAnchor} />
          <DayTasks date={anchor} tasks={tasks} clock={settings.clock} />
        </View>
      ) : null}
      {tasks !== null && mode === "week" ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {range.dates.map((date) => {
              const selected = date === anchor;
              return (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setAnchor(date)}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 8,
                    backgroundColor: selected ? primary : colors.grouped,
                    borderWidth: date === today ? 1.5 : 0,
                    borderColor: ink,
                  }}
                >
                  <Text style={{ color: selected ? onPrimary : colors.label, fontSize: 16 }}>{Number(date.slice(-2))}</Text>
                </Pressable>
              );
            })}
          </View>
          <DayTasks date={anchor} tasks={tasks} clock={settings.clock} />
        </View>
      ) : null}
      {tasks !== null && mode === "day" ? <DayTasks date={anchor} tasks={tasks} clock={settings.clock} /> : null}
      {tasks !== null && mode === "agenda" ? <Agenda dates={range.dates} tasks={tasks} clock={settings.clock} /> : null}
    </ScreenScroll>
  );
}

function DayTasks({ date, tasks, clock }: { date: string; tasks: Task[]; clock: ClockPreference }) {
  const rows = tasks.filter((task) => task.dueOn === date);
  const allDay = rows.filter((task) => !task.dueTime);
  const timed = rows.filter((task) => task.dueTime).sort((a, b) => (a.dueTime ?? "").localeCompare(b.dueTime ?? ""));
  if (rows.length === 0) return <Text style={{ color: colors.label, fontSize: 17 }}>Nothing scheduled.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {allDay.length > 0 ? <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>All day</Text> : null}
      {allDay.map((task) => (
        <TaskRow key={task.id} task={task} detail="All day" checkable={false} onComplete={() => undefined} />
      ))}
      {timed.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          detail={[task.dueTime ? formatClock(task.dueTime, clock) : "", task.durationMinutes ? `${task.durationMinutes} min` : ""]
            .filter((part) => part.length > 0)
            .join(" · ")}
          checkable={false}
          onComplete={() => undefined}
        />
      ))}
    </View>
  );
}

function Agenda({ dates, tasks, clock }: { dates: string[]; tasks: Task[]; clock: ClockPreference }) {
  const filled = dates.filter((date) => tasks.some((task) => task.dueOn === date));
  if (filled.length === 0) return <Text style={{ color: colors.label, fontSize: 17 }}>Nothing scheduled.</Text>;
  return (
    <View style={{ gap: 12 }}>
      {filled.map((date) => (
        <View key={date} style={{ gap: 4 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>{formatDay(date)}</Text>
          {tasks
            .filter((task) => task.dueOn === date)
            .map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                detail={task.dueTime ? formatClock(task.dueTime, clock) : "All day"}
                checkable={false}
                onComplete={() => undefined}
              />
            ))}
        </View>
      ))}
    </View>
  );
}

function visibleRange(mode: Mode, anchor: string, weekStart: WeekStart): { from: string; to: string; label: string; dates: string[] } {
  if (mode === "day") return { from: anchor, to: anchor, label: formatDay(anchor), dates: [anchor] };
  if (mode === "week") {
    const bounds = weekBounds(anchor, weekStart);
    const dates = Array.from({ length: 7 }, (_, index) => addDays(bounds.start, index));
    return { from: bounds.start, to: bounds.end, label: `${formatDay(bounds.start)} – ${formatDay(bounds.end)}`, dates };
  }
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const dates = monthCells(year, month, weekStart).filter((iso): iso is string => iso !== null);
  return { from: dates[0] ?? anchor, to: dates[dates.length - 1] ?? anchor, label: monthLabel(year, month), dates };
}
