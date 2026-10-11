import { useEffect, useState } from "react";
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
  type SleepTimes,
} from "@layp/shared";
import { emptyDay, getDay, saveDay } from "../db/days";
import type { Day } from "../db/types";
import { Button } from "./Button";
import type { SleepBridge } from "./DayRecord";

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
}: {
  clock: ClockPreference;
  viewedDay: string;
  bridge: { current: SleepBridge | null };
  revision: number;
}) {
  const [rows, setRows] = useState<Day[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancel = false;
    Promise.all(sleepCandidateDays(new Date()).map((day) => getDay(day)))
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
    const loaded = await Promise.all(sleepCandidateDays(now).map((day) => getDay(day)));
    return loaded.filter((row): row is Day => row !== null);
  }

  async function write(day: string, patch: Partial<Day>, loaded: Day[]): Promise<Day | null> {
    const existing = loaded.find((row) => row.day === day) ?? (await getDay(day));
    const base = existing ?? emptyDay(day);
    const snap = bridge.current?.snapshot();
    const combined = combineSleep([toSleep(base)], snap?.day === day ? snap : null)[0];
    const next: Day = {
      ...base,
      sleepBed: patch.sleepBed !== undefined ? patch.sleepBed : (combined?.sleepBed ?? base.sleepBed),
      sleepWake: patch.sleepWake !== undefined ? patch.sleepWake : (combined?.sleepWake ?? base.sleepWake),
      sleepHours: patch.sleepHours !== undefined ? patch.sleepHours : (combined?.sleepHours ?? base.sleepHours),
    };
    let result = await saveDay(next, base.updatedAt);
    if (result.status === "conflict" && result.current) {
      result = await saveDay(
        { ...result.current, sleepBed: next.sleepBed, sleepWake: next.sleepWake, sleepHours: next.sleepHours },
        result.current.updatedAt,
      );
    }
    if (result.status !== "saved") return null;
    bridge.current?.applySaved(result.row);
    setRows(replaceDay(loaded, result.row));
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
      const existing = loaded.find((row) => row.day === open.day) ?? (await getDay(open.day));
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
    <div className="flex flex-wrap items-center gap-2" aria-label="Sleep">
      {prompt === "wake" && open ? <p className="meta min-w-0 flex-1">{sleepNightLabel(now, open.day, bedLabel)}</p> : null}
      {notice ? (
        <p className="meta" role="status">
          {notice}
        </p>
      ) : null}
      {prompt === "wake" ? (
        <>
          <Button small variant="primary" disabled={pending} onClick={() => void wakeUp()}>
            I'm awake
          </Button>
          <Button small disabled={pending} onClick={() => void stillUp()}>
            Still up
          </Button>
        </>
      ) : null}
      {prompt === "bed" ? (
        <>
          <Button small variant="primary" disabled={pending} onClick={() => void goToBed(SLEEP_LAG_MINUTES)}>
            In {SLEEP_LAG_MINUTES} minutes
          </Button>
          <Button small disabled={pending} onClick={() => void goToBed(0)}>
            Right now
          </Button>
        </>
      ) : null}
      {showRetry ? (
        <Button small onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
