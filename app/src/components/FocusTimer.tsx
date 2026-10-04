import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { loadTimer, recordFocus, saveTimer } from "../db/focus";
import { playChime, unlockChime } from "../lib/chime";
import { clipForTransition } from "../lib/focusSound";
import { freshTimer, skipPhase, stepTimer, type TimerSnapshot } from "../lib/pomo";
import { useApp } from "../state/AppState";

type FocusApi = {
  timer: TimerSnapshot;
  start: (taskId: string | null) => void;
  choose: (taskId: string | null) => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  cancel: () => void;
};

const Context = createContext<FocusApi | null>(null);

export function useFocus(): FocusApi {
  const value = useContext(Context);
  if (!value) throw new Error("useFocus outside provider");
  return value;
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const work = app.settings.pomoWorkMinutes * 60;
  const rest = app.settings.pomoBreakMinutes * 60;
  const [timer, setTimer] = useState<TimerSnapshot>(() => freshTimer(app.settings.pomoWorkMinutes));
  const timerRef = useRef(timer);
  const ready = useRef(false);
  const bump = useRef(app.bump);
  const sounds = useRef({ work: app.settings.pomoSoundWork, break: app.settings.pomoSoundBreak });
  timerRef.current = timer;
  bump.current = app.bump;
  sounds.current = { work: app.settings.pomoSoundWork, break: app.settings.pomoSoundBreak };

  useEffect(() => {
    let cancel = false;
    loadTimer(app.settings.pomoWorkMinutes)
      .then((loaded) => {
        if (cancel) return;
        ready.current = true;
        timerRef.current = loaded;
        setTimer(loaded);
      })
      .catch(() => {
        ready.current = true;
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!timer.running) return;
    const id = window.setInterval(() => {
      const current = timerRef.current;
      const stepped = stepTimer(current, work, rest);
      timerRef.current = stepped.timer;
      setTimer(stepped.timer);
      void saveTimer(stepped.timer);
      if ((current.phase === "work" || current.phase === "break") && stepped.timer.phase !== current.phase) {
        const clip = clipForTransition(current.phase, sounds.current, "elapsed");
        if (clip) void playChime(clip);
      }
      if (stepped.finishedWork) void recordFocus(current.taskId, stepped.elapsedWorkMinutes).then(() => bump.current());
    }, 1000);
    return () => window.clearInterval(id);
  }, [timer.running, work, rest]);

  function commit(next: TimerSnapshot) {
    timerRef.current = next;
    setTimer(next);
    void saveTimer(next);
  }

  function start(taskId: string | null) {
    if (!ready.current) return;
    unlockChime();
    commit({ taskId, phase: "work", running: true, remainingSeconds: work });
  }

  function choose(taskId: string | null) {
    if (timerRef.current.phase !== "idle") return;
    commit({ ...timerRef.current, taskId });
  }

  function pause() {
    commit({ ...timerRef.current, running: false });
  }

  function resume() {
    const current = timerRef.current;
    unlockChime();
    if (current.phase === "idle") start(current.taskId);
    else commit({ ...current, running: true });
  }

  function skip() {
    const current = timerRef.current;
    const stepped = skipPhase(current, work, rest);
    commit(stepped.timer);
    if (stepped.finishedWork) void recordFocus(current.taskId, stepped.elapsedWorkMinutes).then(() => bump.current());
  }

  function cancel() {
    commit(freshTimer(work / 60));
  }

  const actions = useRef({ pause, resume });
  actions.current = { pause, resume };

  useEffect(() => {
    void invoke("set_tray_timer", { active: timer.phase !== "idle", running: timer.running }).catch(() => undefined);
  }, [timer.phase, timer.running]);

  useEffect(() => {
    let stop = () => {};
    let cancelListen = false;
    void listen("toggle-timer", () => {
      const current = timerRef.current;
      if (current.phase === "idle" || !current.running) actions.current.resume();
      else actions.current.pause();
    }).then((unlisten) => {
      if (cancelListen) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelListen = true;
      stop();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (app.layers > 0) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (timerRef.current.phase === "idle" || !timerRef.current.running) resume();
        else pause();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return <Context.Provider value={{ timer, start, choose, pause, resume, skip, cancel }}>{children}</Context.Provider>;
}
