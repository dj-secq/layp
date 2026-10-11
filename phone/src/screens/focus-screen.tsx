import { playChime } from "@/audio/chime";
import { Centered, ScreenScroll } from "@/components/screen";
import { loadTimer, recordFocus, saveTimer, sessionsOnDay, type FocusSession } from "@/db/focus";
import { tasksOpen } from "@/db/queries";
import { usePhone } from "@/state/phone";
import { colors, onPrimary, primary } from "@/theme/colors";
import { displayFamily } from "@/theme/fonts";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import {
  clipForTransition,
  formatRemaining,
  freshTimer,
  skipPhase,
  stepTimer,
  todayIso,
  type Task,
  type TimerSnapshot,
} from "@layp/shared";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

const ROUNDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function FocusScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const params = useLocalSearchParams<{ taskId?: string | string[] }>();
  const requested = Array.isArray(params.taskId) ? params.taskId[0] : params.taskId;
  const work = settings.pomoWorkMinutes * 60;
  const rest = settings.pomoBreakMinutes * 60;
  const [timer, setTimer] = useState<TimerSnapshot>(() => freshTimer(settings.pomoWorkMinutes));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [goal, setGoal] = useState(1);
  const [round, setRound] = useState(1);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef(timer);
  const ready = useRef(false);
  const goalRef = useRef(goal);
  const roundRef = useRef(round);
  const phaseRef = useRef(timer.phase);
  const sounds = useRef({ work: settings.pomoSoundWork, break: settings.pomoSoundBreak });
  const changed = useRef(phone.changed);
  timerRef.current = timer;
  goalRef.current = goal;
  roundRef.current = round;
  sounds.current = { work: settings.pomoSoundWork, break: settings.pomoSoundBreak };
  changed.current = phone.changed;

  function commit(next: TimerSnapshot) {
    timerRef.current = next;
    setTimer(next);
    void saveTimer(next);
  }

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void loadTimer(settings.pomoWorkMinutes)
      .then((loaded) => {
        if (cancel) return;
        const next = requested && loaded.phase === "idle" ? { ...loaded, taskId: requested } : loaded;
        ready.current = true;
        timerRef.current = next;
        setTimer(next);
        if (next.taskId !== loaded.taskId || loaded.running) void saveTimer(next);
      })
      .catch(() => {
        if (!cancel) {
          ready.current = true;
          setError("Could not load the timer.");
        }
      });
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey]);

  useEffect(() => {
    if (!ready.current || !requested || timerRef.current.phase !== "idle") return;
    if (timerRef.current.taskId === requested) return;
    commit({ ...timerRef.current, taskId: requested });
  }, [requested]);

  useEffect(() => {
    if (!ready.current || timerRef.current.phase !== "idle") return;
    if (timerRef.current.remainingSeconds === work) return;
    commit({ ...timerRef.current, remainingSeconds: work });
  }, [work]);

  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => {
      const current = timerRef.current;
      const stepped = stepTimer(current, work, rest);
      timerRef.current = stepped.timer;
      setTimer(stepped.timer);
      void saveTimer(stepped.timer);
      if ((current.phase === "work" || current.phase === "break") && stepped.timer.phase !== current.phase) {
        const clip = clipForTransition(current.phase, sounds.current, "elapsed");
        if (clip) playChime(clip);
      }
      if (stepped.finishedWork) void recordFocus(current.taskId, stepped.elapsedWorkMinutes).then(() => changed.current());
    }, 1000);
    return () => clearInterval(id);
  }, [timer.running, work, rest]);

  useEffect(() => {
    return () => {
      if (!timerRef.current.running) return;
      const paused = { ...timerRef.current, running: false };
      timerRef.current = paused;
      void saveTimer(paused);
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" || !timerRef.current.running) return;
      commit({ ...timerRef.current, running: false });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const previous = phaseRef.current;
    phaseRef.current = timer.phase;
    if (previous === "break" && timer.phase === "work") {
      if (roundRef.current >= goalRef.current) {
        commit(freshTimer(work / 60));
        setRound(1);
      } else {
        setRound((value) => value + 1);
      }
    }
  }, [timer.phase, work]);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    const today = todayIso();
    void Promise.all([tasksOpen(), sessionsOnDay(today)]).then(
      ([rows, finished]) => {
        if (cancel) return;
        setTasks(rows);
        setSessions(finished);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load focus.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, timer.phase, timer.running]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;

  const phase = timer.phase;
  const idle = phase === "idle";
  const linked = tasks.find((task) => task.id === timer.taskId);
  const phaseLabel = phase === "work" ? "Work" : phase === "break" ? "Break" : "Ready";
  const totalMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);

  function start() {
    if (!ready.current) return;
    setRound(1);
    commit({ taskId: timerRef.current.taskId, phase: "work", running: true, remainingSeconds: work });
  }

  function resume() {
    const current = timerRef.current;
    if (current.phase === "idle") start();
    else commit({ ...current, running: true });
  }

  function skip() {
    const current = timerRef.current;
    const stepped = skipPhase(current, work, rest);
    commit(stepped.timer);
    if (stepped.finishedWork) void recordFocus(current.taskId, stepped.elapsedWorkMinutes).then(() => changed.current());
  }

  return (
    <ScreenScroll>
      <LaypTitle>Focus</LaypTitle>
      <Text style={{ color: colors.label, fontSize: 72, lineHeight: 80, fontVariant: ["tabular-nums"], fontFamily: displayFamily, fontWeight: "400" }}>
        {formatRemaining(timer.remainingSeconds)}
      </Text>
      <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
        {phaseLabel}
        {idle ? "" : ` · round ${round} of ${goal}`}
        {linked ? ` · ${linked.title}` : ""}
      </Text>
      <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
        {settings.pomoWorkMinutes} min work · {settings.pomoBreakMinutes} min break
      </Text>
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {idle ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Rounds</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {ROUNDS.map((value) => {
              const selected = value === goal;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setGoal(value)}
                  style={{
                    backgroundColor: selected ? primary : colors.grouped,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    minWidth: 40,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: selected ? onPrimary : colors.label, fontSize: 16 }}>{value}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable accessibilityRole="button" onPress={() => setPicking((open) => !open)} style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ color: colors.label, fontSize: 17 }}>{linked ? linked.title : "No task"}</Text>
            <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{picking ? "Close" : "Choose a task"}</Text>
          </Pressable>
          {picking ? (
            <View style={{ backgroundColor: colors.grouped, borderRadius: 12, borderCurve: "continuous", paddingHorizontal: 12 }}>
              <TaskChoice label="No task" selected={timer.taskId === null} onPress={() => commit({ ...timerRef.current, taskId: null })} />
              {tasks.map((task) => (
                <TaskChoice
                  key={task.id}
                  label={task.title}
                  selected={timer.taskId === task.id}
                  onPress={() => commit({ ...timerRef.current, taskId: task.id })}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {idle ? <Action label="Start" filled onPress={start} /> : null}
        {!idle && timer.running ? <Action label="Pause" onPress={() => commit({ ...timerRef.current, running: false })} /> : null}
        {!idle && !timer.running ? <Action label="Resume" filled onPress={resume} /> : null}
        {!idle ? <Action label="Skip" onPress={skip} /> : null}
        {!idle ? <Action label="Cancel" onPress={() => commit(freshTimer(work / 60))} /> : null}
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Today</Text>
        {sessions.length === 0 ? <Text style={{ color: colors.label, fontSize: 16 }}>No finished sessions today.</Text> : null}
        {sessions.map((session) => (
          <Text key={session.endedAt} style={{ color: colors.label, fontSize: 16 }}>
            {sessionClock(session.endedAt)} · {session.minutes} minutes
          </Text>
        ))}
        {sessions.length > 0 ? (
          <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>{totalMinutes} minutes today</Text>
        ) : null}
      </View>
    </ScreenScroll>
  );
}

function TaskChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.separator }}
    >
      <Text style={{ color: selected ? colors.label : colors.secondaryLabel, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

function Action({ label, onPress, filled = false }: { label: string; onPress: () => void; filled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        backgroundColor: filled ? primary : colors.grouped,
        borderRadius: 12,
        borderCurve: "continuous",
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: filled ? onPrimary : colors.label, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function sessionClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
