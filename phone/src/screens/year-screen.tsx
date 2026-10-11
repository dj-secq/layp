import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import { completedDaysBetween, daysBetween, loadTrackers, logsBetween, type Tracker, type TrackerLog } from "@/db/journal";
import { usePhone } from "@/state/phone";
import { colors, ink } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import {
  MOOD_COLORS,
  YEAR_MODE_LABELS,
  cellScheduled,
  dayShownUp,
  isSuccess,
  monthCells,
  monthLabel,
  sleepRangeLabel,
  todayIso,
  weekdayLabels,
  yearBarColor,
  yearModes,
  type YearMode,
} from "@layp/shared";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

export function YearScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const today = todayIso();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [mode, setMode] = useState<YearMode>("mood");
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [logs, setLogs] = useState<Map<string, TrackerLog>>(new Map());
  const [days, setDays] = useState<Map<string, { mood: number | null; sleepHours: number | null; workout: "yes" | "no" | null }>>(new Map());
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    setReady(false);
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    void Promise.all([loadTrackers(false), logsBetween(from, to), daysBetween(from, to), completedDaysBetween(from, to)]).then(
      ([nextTrackers, nextLogs, nextDays, nextCompleted]) => {
        if (cancel) return;
        setTrackers(nextTrackers);
        setLogs(new Map(nextLogs.map((log) => [`${log.trackerId}|${log.day}`, log])));
        setDays(new Map(nextDays.map((day) => [day.day, day])));
        setCompleted(new Set(nextCompleted));
        setError(null);
        setReady(true);
      },
      () => {
        if (!cancel) setError("Could not load the year.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, year, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && !ready) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  return (
    <ScreenScroll>
      <LaypTitle>Year</LaypTitle>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <TextButton label="Previous" onPress={() => setYear((value) => value - 1)} />
        <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{year}</Text>
        <TextButton label="Next" onPress={() => setYear((value) => value + 1)} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {yearModes.map((item) => (
          <TextButton key={item} label={YEAR_MODE_LABELS[item]} onPress={() => setMode(item)} />
        ))}
      </View>
      {!ready ? <Text style={{ color: colors.label }}>Loading the year…</Text> : null}
      {ready ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {Array.from({ length: 12 }, (_, index) => {
            const month = index + 1;
            const cells = monthCells(year, month, settings.weekStart);
            return (
              <View key={month} style={{ width: "48%", gap: 4 }}>
                <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>{monthLabel(year, month)}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {weekdayLabels(settings.weekStart).map((label) => (
                    <Text key={label} style={{ width: "14.28%", textAlign: "center", fontSize: 9, color: colors.secondaryLabel }}>{label.slice(0, 1)}</Text>
                  ))}
                  {cells.map((iso, cellIndex) => {
                    if (!iso) return <View key={`b-${cellIndex}`} style={{ width: "14.28%", height: 22 }} />;
                    const color = colorFor(iso, mode, trackers, logs, days.get(iso), completed.has(iso));
                    return (
                      <Pressable
                        key={iso}
                        accessibilityRole="button"
                        onPress={() => router.push({ pathname: "/today", params: { date: iso } })}
                        style={{
                          width: "14.28%",
                          height: 22,
                          alignItems: "center",
                          borderRadius: 2,
                          borderWidth: iso === today ? 1 : 0,
                          borderColor: ink,
                        }}
                      >
                        <Text style={{ color: colors.label, fontSize: 9 }}>{Number(iso.slice(-2))}</Text>
                        <View style={{ width: 12, height: 3, borderRadius: 1, backgroundColor: color ?? "transparent" }} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      {ready ? <YearKey mode={mode} sleepHours={[...days.values()].map((day) => day.sleepHours)} /> : null}
    </ScreenScroll>
  );
}

function colorFor(
  iso: string,
  mode: YearMode,
  trackers: Tracker[],
  logs: Map<string, TrackerLog>,
  day: { mood: number | null; sleepHours: number | null; workout: "yes" | "no" | null } | undefined,
  taskCompleted: boolean,
): string | null {
  const hobbies = trackers.filter((tracker) => tracker.isHobby);
  let hobbyColor: string | null = null;
  let best = 0;
  let hobbyMinutes = 0;
  for (const hobby of hobbies) {
    const log = logs.get(`${hobby.id}|${iso}`);
    const minutes = log?.state === "done" && log.value && log.value > 0 ? log.value : 0;
    hobbyMinutes += minutes;
    if (minutes > best) {
      best = minutes;
      hobbyColor = hobby.color;
    }
  }
  const trackerDone = trackers.some((tracker) => {
    if (tracker.isHobby || !cellScheduled(tracker.schedule, iso)) return false;
    const log = logs.get(`${tracker.id}|${iso}`);
    return isSuccess(tracker.kind, tracker.dailyTarget, log ? { day: log.day, state: log.state, value: log.value } : null);
  });
  return yearBarColor({
    mode,
    mood: day?.mood ?? null,
    shown: dayShownUp({ taskCompleted, workoutYes: day?.workout === "yes", hobbyMinutes, trackerDone }),
    sleepHours: day?.sleepHours ?? null,
    workoutYes: day?.workout === "yes",
    taskCompleted,
    hobbyColor,
  });
}

function YearKey({ mode, sleepHours }: { mode: YearMode; sleepHours: Array<number | null> }) {
  usePaper();
  if (mode === "mood") {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Text style={{ color: colors.secondaryLabel }}>Mood</Text>
        {MOOD_COLORS.map((swatch, index) => (
          <View key={swatch} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: swatch }} />
            <Text style={{ color: colors.label }}>{index + 1}</Text>
          </View>
        ))}
      </View>
    );
  }
  const caption =
    mode === "sleep"
      ? sleepRangeLabel(sleepHours)
      : mode === "workout"
        ? "Workout marked yes"
        : mode === "tasks"
          ? "A task completed"
          : mode === "hobby"
            ? "Hobby with the most minutes"
            : "Shown up";
  return <Text style={{ color: colors.label }}>{caption}</Text>;
}
