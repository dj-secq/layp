import { useEffect, useRef, useState } from "react";
import { getDay, saveDay } from "../db/days";
import { emptyDay, type Day } from "../db/types";
import { MOOD_COLORS } from "../lib/stickers";
import { formatClock, parseClock } from "../lib/clock";
import { useApp } from "../state/AppState";
import { cleanSleep, formatHours, suggestedSleepHours } from "../lib/sleep";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { DayTrackers } from "./DayTrackers";
import { Dialog } from "./Dialog";

export function DayRecord({ date }: { date: string }) {
  const clock = useApp().settings.clock;
  const [record, setRecord] = useState<Day | null>(null);
  const [sleepText, setSleepText] = useState("");
  const [bedText, setBedText] = useState("");
  const [wakeText, setWakeText] = useState("");
  const [sleepError, setSleepError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [diary, setDiary] = useState("");
  const [notSaved, setNotSaved] = useState(false);
  const [conflict, setConflict] = useState<Day | null>(null);
  const draft = useRef<Day | null>(null);
  const expected = useRef("");
  const chain = useRef(Promise.resolve());
  const hydrated = useRef(false);

  function adopt(next: Day) {
    draft.current = next;
    expected.current = next.updatedAt;
    setRecord(next);
    setSleepText(next.sleepHours === null ? "" : String(next.sleepHours));
    setBedText(next.sleepBed ? formatClock(next.sleepBed, clock) : "");
    setWakeText(next.sleepWake ? formatClock(next.sleepWake, clock) : "");
    setNote(next.workoutNote);
    setDiary(next.diary);
    setSleepError(null);
    setNotSaved(false);
    setConflict(null);
  }

  useEffect(() => {
    let cancel = false;
    hydrated.current = false;
    setRecord(null);
    getDay(date)
      .then((row) => {
        if (cancel) return;
        adopt(row ?? emptyDay(date));
        hydrated.current = true;
      })
      .catch(() => {
        if (cancel) return;
        setNotSaved(true);
        hydrated.current = true;
      });
    return () => {
      cancel = true;
    };
  }, [date]);

  function enqueue(force = false) {
    chain.current = chain.current.then(async () => {
      const current = draft.current;
      if (!current) return;
      const result = await saveDay(current, expected.current, force);
      if (result.status === "saved") {
        expected.current = result.row.updatedAt;
        draft.current = result.row;
        setRecord(result.row);
        setNotSaved(false);
        setConflict(null);
        return;
      }
      setNotSaved(true);
      if (result.status === "conflict" && result.current) setConflict(result.current);
    });
  }

  function apply(patch: Partial<Day>, force = false) {
    const current = draft.current;
    if (!current) return;
    const next = { ...current, ...patch };
    draft.current = next;
    setRecord(next);
    enqueue(force);
  }

  function commitTime(text: string, key: "sleepBed" | "sleepWake", setText: (value: string) => void) {
    const parsed = parseClock(text);
    if (text.trim() && parsed === null) {
      const current = draft.current?.[key] ?? null;
      setText(current ? formatClock(current, clock) : "");
      return;
    }
    setText(parsed ? formatClock(parsed, clock) : "");
    if (parsed !== (draft.current?.[key] ?? null)) apply({ [key]: parsed });
  }

  useEffect(() => {
    if (!hydrated.current || draft.current?.day !== date) return;
    if (diary === draft.current.diary) return;
    const handle = window.setTimeout(() => {
      if (draft.current?.day === date) apply({ diary });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [diary, date]);

  if (!record) {
    return (
      <section className="panel" aria-label="Day record">
        <Skeleton kind="rows" label="Loading this day" />
      </section>
    );
  }

  const suggestion = record.sleepHours === null ? suggestedSleepHours(record.sleepBed, record.sleepWake) : null;

  return (
    <section className="panel grid gap-4" aria-label="Day record">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="page-title">Day</h2>
        <span role="status" className="meta text-danger">
          {notSaved ? "Not saved" : ""}
        </span>
      </div>

      <label className="grid gap-1">
        <span className="label">Sleep</span>
        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <input
            className="field nums"
            inputMode="decimal"
            aria-label="Sleep hours"
            value={sleepText}
            placeholder="Hours"
            onChange={(event) => setSleepText(event.target.value)}
            onBlur={() => {
              const parsed = cleanSleep(sleepText);
              if ("error" in parsed) {
                setSleepError(parsed.error);
                setNotSaved(true);
                return;
              }
              setSleepError(null);
              setSleepText(parsed.hours === null ? "" : String(parsed.hours));
              if (parsed.hours !== draft.current?.sleepHours) apply({ sleepHours: parsed.hours });
            }}
          />
          <span className="meta">hours</span>
        </span>
        {sleepError ? <span className="meta text-danger">{sleepError}</span> : null}
      </label>

      <div className="grid min-w-0 grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="label">Bed</span>
          <input
            className="field nums"
            aria-label="Bed"
            value={bedText}
            placeholder={clock === "12" ? "11:30 PM" : "23:30"}
            onChange={(event) => setBedText(event.target.value)}
            onBlur={() => commitTime(bedText, "sleepBed", setBedText)}
          />
        </label>
        <label className="grid gap-1">
          <span className="label">Wake</span>
          <input
            className="field nums"
            aria-label="Wake"
            value={wakeText}
            placeholder={clock === "12" ? "7:00 AM" : "07:00"}
            onChange={(event) => setWakeText(event.target.value)}
            onBlur={() => commitTime(wakeText, "sleepWake", setWakeText)}
          />
        </label>
      </div>

      {suggestion !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--border)] bg-surface p-3">
          <span className="priority-mark" style={{ background: "var(--primary)" }} aria-hidden />
          <p className="min-w-0 flex-1">Bed to wake is {formatHours(suggestion)} hours.</p>
          <Button
            variant="secondary"
            onClick={() => {
              setSleepText(formatHours(suggestion));
              setSleepError(null);
              apply({ sleepHours: suggestion });
            }}
          >
            Use {formatHours(suggestion)}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-1">
        <span className="label">Workout</span>
        <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Workout">
          {(
            [
              ["Not filled", null],
              ["Yes", "yes"],
              ["No", "no"],
            ] as const
          ).map(([label, value]) => (
            <Button
              key={label}
              variant={record.workout === value ? "primary" : "secondary"}
              aria-pressed={record.workout === value}
              onClick={() => {
                if (record.workout !== value) apply({ workout: value });
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <label className="grid gap-1">
        <span className="label">Workout note</span>
        <input
          className="field"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note !== draft.current?.workoutNote) apply({ workoutNote: note });
          }}
        />
      </label>

      <div className="grid gap-1">
        <span className="label">Mood</span>
        <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Mood">
          {MOOD_COLORS.map((color, index) => {
            const mood = index + 1;
            const selected = record.mood === mood;
            return (
              <button
                key={color}
                type="button"
                className="mood press-sm"
                style={{
                  background: selected ? color : "var(--surface)",
                  color: selected ? "#111111" : "var(--ink)",
                }}
                aria-pressed={selected}
                aria-label={`Mood ${mood}`}
                onClick={() => apply({ mood: selected ? null : mood })}
              >
                {mood}
              </button>
            );
          })}
        </div>
      </div>

      <DayTrackers date={date} />

      <label className="grid gap-1">
        <span className="label">Diary</span>
        <textarea
          className="area"
          value={diary}
          aria-label="Diary"
          onChange={(event) => setDiary(event.target.value)}
          onBlur={() => {
            if (draft.current && diary !== draft.current.diary) apply({ diary });
          }}
        />
      </label>

      {notSaved ? (
        <Button variant="secondary" onClick={() => enqueue(false)}>
          Retry
        </Button>
      ) : null}

      {conflict ? (
        <Dialog
          title="Not saved"
          onClose={() => setConflict(null)}
        >
          <p>This was saved from a newer edit. Your latest keystrokes are still in the form.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => {
                setConflict(null);
                enqueue(true);
              }}
            >
              Keep mine
            </Button>
            <Button variant="secondary" onClick={() => adopt(conflict)}>
              Use saved
            </Button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
