import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import { daysBetween, loadTrackers, logsBetween, monthBounds, type DaySnap, type Tracker, type TrackerLog } from "@/db/journal";
import { colors, ink, onPrimary, primary } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { usePhone } from "@/state/phone";
import { MOOD_COLORS, averageSleep, leadingHobby, monthCells, monthLabel, shiftMonth, sumMinutes, todayIso, weekdayLabels } from "@layp/shared";
import { Redirect, Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

export function MonthJournalScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const today = todayIso();
  const [cursor, setCursor] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [days, setDays] = useState<Map<string, DaySnap>>(new Map());
  const [logs, setLogs] = useState<TrackerLog[]>([]);
  const [hobbies, setHobbies] = useState<Tracker[]>([]);
  const [selected, setSelected] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const bounds = monthBounds(cursor.year, cursor.month);
  const cells = monthCells(cursor.year, cursor.month, settings.weekStart);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    setReady(false);
    void Promise.all([loadTrackers(false), logsBetween(bounds.from, bounds.to), daysBetween(bounds.from, bounds.to)]).then(
      ([trackers, nextLogs, nextDays]) => {
        if (cancel) return;
        setHobbies(trackers.filter((tracker) => tracker.isHobby));
        setLogs(nextLogs);
        setDays(new Map(nextDays.map((day) => [day.day, day])));
        setError(null);
        setReady(true);
      },
      () => {
        if (!cancel) setError("Could not load the month.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, bounds.from, bounds.to, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && !ready) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  const sleep = [...days.values()].map((day) => day.sleepHours);
  const workoutDays = [...days.values()].filter((day) => day.workout === "yes").length;
  const selectedDay = days.get(selected);
  const selectedHobbies = hobbies.map((hobby) => {
    const log = logs.find((item) => item.trackerId === hobby.id && item.day === selected && item.state === "done");
    return { name: hobby.name, minutes: log?.value && log.value > 0 ? log.value : 0 };
  });

  function shift(delta: number) {
    const next = shiftMonth(cursor.year, cursor.month, delta);
    setCursor(next);
    setSelected(`${next.year}-${String(next.month).padStart(2, "0")}-01`);
  }

  return (
    <ScreenScroll>
      <Stack.Title>Month</Stack.Title>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <TextButton label="Previous" onPress={() => shift(-1)} />
        <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{monthLabel(cursor.year, cursor.month)}</Text>
        <TextButton label="Next" onPress={() => shift(1)} />
      </View>
      {!ready ? <Text style={{ color: colors.label }}>Loading the month…</Text> : null}
      <View style={{ flexDirection: "row" }}>
        {weekdayLabels(settings.weekStart).map((label) => (
          <Text key={label} style={{ width: "14.28%", textAlign: "center", color: colors.secondaryLabel, fontSize: 11 }}>{label.slice(0, 1)}</Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((iso, index) => {
          if (!iso) return <View key={`b-${index}`} style={{ width: "14.28%", minHeight: 48 }} />;
          const day = days.get(iso);
          const slices = hobbies.map((hobby) => {
            const log = logs.find((item) => item.trackerId === hobby.id && item.day === iso && item.state === "done");
            return { id: hobby.id, color: hobby.color, minutes: log?.value && log.value > 0 ? log.value : 0 };
          });
          const lead = leadingHobby(slices);
          const on = iso === selected;
          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setSelected(iso)}
              style={{
                width: "14.28%",
                minHeight: 48,
                alignItems: "center",
                borderRadius: 6,
                backgroundColor: on ? primary : colors.grouped,
                borderWidth: iso === today ? 1.5 : 0,
                borderColor: ink,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: on ? onPrimary : colors.label, fontSize: 13 }}>{Number(iso.slice(-2))}</Text>
              {day?.mood ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: MOOD_COLORS[day.mood - 1] }} /> : null}
              {lead ? <View style={{ width: 16, height: 4, borderRadius: 2, backgroundColor: lead.color, marginTop: 2 }} /> : null}
            </Pressable>
          );
        })}
      </View>
      {ready ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{selected}</Text>
          <Text style={{ color: colors.label }}>Sleep {selectedDay?.sleepHours ?? "—"}</Text>
          <Text style={{ color: colors.label }}>Workout {selectedDay?.workout === "yes" ? "yes" : "—"}</Text>
          <Text style={{ color: colors.label }}>Mood {selectedDay?.mood ?? "—"}</Text>
          {selectedHobbies.map((hobby) => (
            <Text key={hobby.name} style={{ color: colors.label }}>{hobby.name} {hobby.minutes} min</Text>
          ))}
          <TextButton label="Open day" onPress={() => router.push({ pathname: "/today", params: { date: selected } })} />
          <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>Totals</Text>
          <Text style={{ color: colors.label }}>Sleep {averageSleep(sleep) ?? "No sleep"}</Text>
          <Text style={{ color: colors.label }}>Workout days {workoutDays}</Text>
          {hobbies.map((hobby) => (
            <Text key={hobby.id} style={{ color: colors.label }}>
              {hobby.name} {sumMinutes(logs.filter((log) => log.trackerId === hobby.id), bounds.from, bounds.to)} min
            </Text>
          ))}
        </View>
      ) : null}
    </ScreenScroll>
  );
}
