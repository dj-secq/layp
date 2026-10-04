import { Pause, Play, SkipForward, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Choice } from "../components/Choice";
import { useFocus } from "../components/FocusTimer";
import { sessionsBetween } from "../db/focus";
import { tasksOpen } from "../db/tasks";
import type { Task } from "../db/types";
import { clampPomoMinutes, formatRemaining } from "../lib/pomo";
import { useApp } from "../state/AppState";

const PRESETS = [
  { label: "25 / 5", work: 25, rest: 5 },
  { label: "50 / 10", work: 50, rest: 10 },
  { label: "15 / 5", work: 15, rest: 5 },
] as const;

const RING_RADIUS = 118;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function FocusScreen() {
  const app = useApp();
  const focus = useFocus();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Array<{ endedAt: string; minutes: number }>>([]);
  const [goal, setGoal] = useState(1);
  const [round, setRound] = useState(1);
  const phase = focus.timer.phase;
  const running = focus.timer.running;
  const phaseRef = useRef(phase);
  const roundRef = useRef(round);
  const goalRef = useRef(goal);
  const cancelRef = useRef(focus.cancel);
  roundRef.current = round;
  goalRef.current = goal;
  cancelRef.current = focus.cancel;

  useEffect(() => {
    let cancel = false;
    tasksOpen()
      .then((rows) => {
        if (!cancel) setTasks(rows);
      })
      .catch(() => undefined);
    const zone = Temporal.Now.timeZoneId();
    const start = Temporal.PlainDate.from(app.civilToday).toZonedDateTime(zone).toInstant().toString();
    const end = Temporal.PlainDate.from(app.civilToday).add({ days: 1 }).toZonedDateTime(zone).toInstant().subtract({ milliseconds: 1 }).toString();
    sessionsBetween(start, end)
      .then((rows) => {
        if (!cancel) setSessions(rows);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [app.civilToday, app.revision, phase, running]);

  useEffect(() => {
    const previous = phaseRef.current;
    phaseRef.current = phase;
    if (previous === "break" && phase === "work") {
      if (roundRef.current >= goalRef.current) {
        cancelRef.current();
        setRound(1);
      } else {
        setRound((value) => value + 1);
      }
    }
  }, [phase]);

  const linked = tasks.find((task) => task.id === focus.timer.taskId);
  const idle = phase === "idle";
  const phaseLabel = phase === "work" ? "Work" : phase === "break" ? "Break" : "Ready";
  const totalMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const totalSeconds = (phase === "break" ? app.settings.pomoBreakMinutes : app.settings.pomoWorkMinutes) * 60;
  const progress = totalSeconds <= 0 ? 0 : Math.min(1, Math.max(0, 1 - focus.timer.remainingSeconds / totalSeconds));
  const stroke = phase === "break" ? "#7dd3fc" : "var(--primary)";

  const setup = (
    <>
      <div className="page-tools" role="group" aria-label="Study length">
        {PRESETS.map((preset) => {
          const selected = app.settings.pomoWorkMinutes === preset.work && app.settings.pomoBreakMinutes === preset.rest;
          return (
            <button
              key={preset.label}
              type="button"
              className={selected ? "press btn-primary" : "press btn-secondary"}
              aria-pressed={selected}
              disabled={!idle}
              onClick={() => void app.updateSettings({ pomoWorkMinutes: preset.work, pomoBreakMinutes: preset.rest })}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <MinuteField
          label="Work minutes"
          value={app.settings.pomoWorkMinutes}
          disabled={!idle}
          onSave={(minutes) => void app.updateSettings({ pomoWorkMinutes: minutes })}
        />
        <MinuteField
          label="Break minutes"
          value={app.settings.pomoBreakMinutes}
          disabled={!idle}
          onSave={(minutes) => void app.updateSettings({ pomoBreakMinutes: minutes })}
        />
        <Choice
          stack
          label="Rounds"
          value={String(goal)}
          disabled={!idle}
          options={Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
          onChange={(value) => setGoal(Number(value))}
        />
      </div>
      <Choice
        stack
        label="Task"
        value={focus.timer.taskId ?? ""}
        disabled={!idle}
        options={[{ value: "", label: "No task" }, ...tasks.map((task) => ({ value: task.id, label: task.title }))]}
        onChange={(taskId) => focus.choose(taskId || null)}
      />
    </>
  );

  const controls = (align: "start" | "center") => (
    <div className={align === "center" ? "flex flex-wrap justify-center gap-2" : "flex flex-wrap gap-2"}>
      {phase === "idle" ? (
        <button
          type="button"
          className="press btn-primary"
          onClick={() => {
            setRound(1);
            focus.start(focus.timer.taskId);
          }}
        >
          <Play size={16} strokeWidth={1.75} aria-hidden />
          Start
        </button>
      ) : null}
      {phase !== "idle" && running ? (
        <button type="button" className="press btn-secondary" onClick={() => focus.pause()}>
          <Pause size={16} strokeWidth={1.75} aria-hidden />
          Pause
        </button>
      ) : null}
      {phase !== "idle" && !running ? (
        <button type="button" className="press btn-primary" onClick={() => focus.resume()}>
          <Play size={16} strokeWidth={1.75} aria-hidden />
          Resume
        </button>
      ) : null}
      {phase !== "idle" ? (
        <button type="button" className="press btn-secondary" onClick={() => focus.skip()}>
          <SkipForward size={16} strokeWidth={1.75} aria-hidden />
          Skip
        </button>
      ) : null}
      {phase !== "idle" ? (
        <button type="button" className="press btn-danger" onClick={() => focus.cancel()}>
          <X size={16} strokeWidth={1.75} aria-hidden />
          Cancel
        </button>
      ) : null}
    </div>
  );

  const todayList = (
    <section>
      <h2 className="group-label">Today</h2>
      {sessions.length === 0 ? <p>No finished sessions today.</p> : null}
      {sessions.map((session) => (
        <p key={session.endedAt} className="meta">
          {sessionClock(session.endedAt)} · {session.minutes} minutes
        </p>
      ))}
      {sessions.length > 0 ? <p className="label">{totalMinutes} minutes today</p> : null}
    </section>
  );

  if (!idle) {
    return (
      <div className="focus-run">
        <div className="focus-center">
          <div className="focus-clock">
            <svg viewBox="0 0 300 300" aria-hidden>
              <circle className="focus-ring" cx="150" cy="150" r={RING_RADIUS} stroke="var(--muted)" />
              <circle
                className="focus-ring"
                cx="150"
                cy="150"
                r={RING_RADIUS}
                stroke={stroke}
                strokeDasharray={RING_LENGTH}
                strokeDashoffset={RING_LENGTH * (1 - progress)}
                transform="rotate(-90 150 150)"
              />
            </svg>
            <p className="focus-clock-num display nums">{formatRemaining(focus.timer.remainingSeconds)}</p>
          </div>
          <p className="label">
            {phaseLabel} · round {round} of {goal}
            {linked ? ` · ${linked.title}` : ""}
          </p>
          {controls("center")}
        </div>
        <div className="focus-sessions">{todayList}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <h1 className="page-title screen-head">Focus</h1>
      <p className="display nums text-[72px] leading-none">{formatRemaining(focus.timer.remainingSeconds)}</p>
      <p className="label">Ready</p>
      {setup}
      {controls("start")}
      {todayList}
    </div>
  );
}

function MinuteField({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onSave: (minutes: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="grid gap-1">
      <span className="label">{label}</span>
      <input
        className="field"
        inputMode="numeric"
        disabled={disabled}
        value={text}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const minutes = clampPomoMinutes(Number(text));
          setText(String(minutes));
          if (minutes !== value) onSave(minutes);
        }}
      />
    </label>
  );
}

function sessionClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
