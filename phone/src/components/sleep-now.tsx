import {
  SLEEP_LAG_MINUTES,
  combineSleep,
  formatClock,
  localDay,
  openSleep,
  planBed,
  planWake,
  sleepBusyLabel,
  sleepCandidateDays,
  sleepNightLabel,
  sleepPrompt,
  type ClockPreference,
  type Day,
  type SleepTimes,
} from "@layp/shared";
import { useEffect, useState } from "react";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { emptyDay, loadDay, saveDay } from "../db/days";
import { colors, primary } from "../theme/colors";
import { usePaper } from "../theme/theme";
import type { SleepBridge } from "./day-record";

function toSleep(day: Day): SleepTimes {
  return { day: day.day, sleepBed: day.sleepBed, sleepWake: day.sleepWake, sleepHours: day.sleepHours };
}

function replaceDay(rows: Day[], row: Day): Day[] {
  return [...rows.filter((item) => item.day !== row.day), row];
}

export function SleepNow({
  clock,
  viewedDay,
  bridge,
  revision,
  onSaved,
}: {
  clock: ClockPreference;
  viewedDay: string;
  bridge: { current: SleepBridge | null };
  revision: number;
  onSaved: () => void;
}) {
  useColorScheme();
  usePaper();
  const [rows, setRows] = useState<Day[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancel = false;
    void Promise.all(sleepCandidateDays(new Date()).map((day) => loadDay(day)))
      .then((loaded) => {
        if (cancel) return;
        const days = loaded.filter((row): row is Day => row !== null);
        setRows(days);
        setFailed(false);
        const match = days.find((row) => row.day === viewedDay);
        if (match) bridge.current?.applySaved(match);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => {
      cancel = true;
    };
  }, [revision, attempt, viewedDay, bridge]);

  async function readCandidates(now: Date): Promise<Day[]> {
    const loaded = await Promise.all(sleepCandidateDays(now).map((day) => loadDay(day)));
    return loaded.filter((row): row is Day => row !== null);
  }

  async function write(day: string, patch: Partial<Day>, loaded: Day[]): Promise<Day | null> {
    const existing = loaded.find((row) => row.day === day) ?? (await loadDay(day));
    const base = existing ?? emptyDay(day);
    const snap = bridge.current?.snapshot();
    const combined = combineSleep([toSleep(base)], snap?.day === day ? snap : null)[0];
    const next: Day = {
      ...base,
      sleepBed: patch.sleepBed !== undefined ? patch.sleepBed : (combined?.sleepBed ?? base.sleepBed),
      sleepWake: patch.sleepWake !== undefined ? patch.sleepWake : (combined?.sleepWake ?? base.sleepWake),
      sleepHours: patch.sleepHours !== undefined ? patch.sleepHours : (combined?.sleepHours ?? base.sleepHours),
    };
    let result = await saveDay(next);
    if (result.status === "conflict") {
      result = await saveDay({
        ...result.current,
        sleepBed: next.sleepBed,
        sleepWake: next.sleepWake,
        sleepHours: next.sleepHours,
      });
    }
    if (result.status !== "saved") return null;
    bridge.current?.applySaved(result.row);
    setRows(replaceDay(loaded, result.row));
    onSaved();
    return result.row;
  }

  async function goToBed(addMinutes: number) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const now = new Date();
      const loaded = await readCandidates(now);
      const plan = planBed(now, combineSleep(loaded.map(toSleep), bridge.current?.snapshot() ?? null), addMinutes);
      if (plan.kind === "busy") {
        setRows(loaded);
        setNotice(sleepBusyLabel(now, plan.day));
        return;
      }
      const saved = await write(plan.day, { sleepBed: plan.time }, loaded);
      if (!saved) setNotice("Not saved");
    } catch {
      setNotice("Not saved");
    } finally {
      setPending(false);
    }
  }

  async function wakeUp() {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const now = new Date();
      const loaded = await readCandidates(now);
      const plan = planWake(now, combineSleep(loaded.map(toSleep), bridge.current?.snapshot() ?? null));
      if (plan.kind === "none") {
        setRows(loaded);
        setNotice("There is no bedtime yet.");
        return;
      }
      const saved = await write(plan.day, { sleepWake: plan.time, sleepHours: plan.hours }, loaded);
      if (!saved) setNotice("Not saved");
    } catch {
      setNotice("Not saved");
    } finally {
      setPending(false);
    }
  }

  async function stillUp() {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const now = new Date();
      const loaded = await readCandidates(now);
      const open = openSleep(now, combineSleep(loaded.map(toSleep), bridge.current?.snapshot() ?? null));
      if (!open) {
        setRows(loaded);
        return;
      }
      const existing = loaded.find((row) => row.day === open.day) ?? (await loadDay(open.day));
      if (!existing) {
        bridge.current?.clearBed();
        setRows(loaded);
        return;
      }
      const saved = await write(open.day, { sleepBed: null }, loaded);
      if (!saved) setNotice("Not saved");
    } catch {
      setNotice("Not saved");
    } finally {
      setPending(false);
    }
  }

  const now = new Date();
  const times = rows?.map(toSleep) ?? null;
  const prompt = times ? sleepPrompt(now, times, viewedDay) : "quiet";
  const open = times ? openSleep(now, times) : null;
  const showRetry = failed && rows === null && viewedDay === localDay(now);
  if (prompt === "quiet" && !showRetry) return null;
  const bedLabel = open?.sleepBed ? formatClock(open.sleepBed, clock) : "";

  return (
    <View accessibilityLabel="Sleep" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      {prompt === "wake" && open ? (
        <Text style={{ color: colors.secondaryLabel, fontSize: 15, flexShrink: 1 }}>{sleepNightLabel(now, open.day, bedLabel)}</Text>
      ) : null}
      {notice ? <Text style={{ color: colors.label, fontSize: 15 }}>{notice}</Text> : null}
      {prompt === "wake" ? (
        <>
          <Action label="I'm awake" filled disabled={pending} onPress={() => void wakeUp()} />
          <Action label="Still up" disabled={pending} onPress={() => void stillUp()} />
        </>
      ) : null}
      {prompt === "bed" ? (
        <>
          <Action label={`In ${SLEEP_LAG_MINUTES} minutes`} filled disabled={pending} onPress={() => void goToBed(SLEEP_LAG_MINUTES)} />
          <Action label="Right now" disabled={pending} onPress={() => void goToBed(0)} />
        </>
      ) : null}
      {showRetry ? <Action label="Retry" onPress={() => setAttempt((value) => value + 1)} /> : null}
    </View>
  );
}

function Action({
  label,
  filled = false,
  disabled = false,
  onPress,
}: {
  label: string;
  filled?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  useColorScheme();
  usePaper();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: filled ? primary : colors.background,
        borderRadius: 14,
        borderCurve: "continuous",
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: filled ? "#111111" : colors.label, fontSize: 15, fontWeight: "600", textAlign: "center" }}>
        {label}
      </Text>
    </Pressable>
  );
}
