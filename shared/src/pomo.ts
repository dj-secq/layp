export type TimerPhase = "idle" | "work" | "break";

export type TimerSnapshot = {
  taskId: string | null;
  phase: TimerPhase;
  running: boolean;
  remainingSeconds: number;
};

export function clampPomoMinutes(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(180, Math.max(1, Math.round(value)));
}

export function freshTimer(workMinutes: number): TimerSnapshot {
  return { taskId: null, phase: "idle", running: false, remainingSeconds: clampPomoMinutes(workMinutes) * 60 };
}

/** A timer that was still running when Layp quit comes back paused, with the remaining time kept. */
export function pausedOnLaunch(timer: TimerSnapshot): TimerSnapshot {
  return timer.running ? { ...timer, running: false } : timer;
}

export function stepTimer(timer: TimerSnapshot, workSeconds: number, breakSeconds: number): {
  timer: TimerSnapshot;
  finishedWork: boolean;
  elapsedWorkMinutes: number;
} {
  if (!timer.running || timer.phase === "idle") {
    return { timer, finishedWork: false, elapsedWorkMinutes: 0 };
  }
  if (timer.remainingSeconds > 1) {
    return { timer: { ...timer, remainingSeconds: timer.remainingSeconds - 1 }, finishedWork: false, elapsedWorkMinutes: 0 };
  }
  const finishedWork = timer.phase === "work";
  const full = timer.phase === "work" ? workSeconds : breakSeconds;
  const elapsedWorkMinutes = finishedWork ? Math.max(1, Math.round(full / 60)) : 0;
  if (finishedWork) {
    return {
      timer: { ...timer, phase: "break", running: true, remainingSeconds: Math.max(60, breakSeconds) },
      finishedWork: true,
      elapsedWorkMinutes,
    };
  }
  return {
    timer: { ...timer, phase: "work", running: true, remainingSeconds: Math.max(60, workSeconds) },
    finishedWork: false,
    elapsedWorkMinutes: 0,
  };
}

export function skipPhase(timer: TimerSnapshot, workSeconds: number, breakSeconds: number): {
  timer: TimerSnapshot;
  finishedWork: boolean;
  elapsedWorkMinutes: number;
} {
  if (timer.phase === "idle") return { timer, finishedWork: false, elapsedWorkMinutes: 0 };
  const spent = Math.max(0, (timer.phase === "work" ? workSeconds : breakSeconds) - timer.remainingSeconds);
  const elapsedWorkMinutes = timer.phase === "work" ? Math.round(spent / 60) : 0;
  if (timer.phase === "work") {
    return {
      timer: { ...timer, phase: "break", running: true, remainingSeconds: Math.max(60, breakSeconds) },
      finishedWork: elapsedWorkMinutes > 0,
      elapsedWorkMinutes,
    };
  }
  return {
    timer: { ...timer, phase: "work", running: true, remainingSeconds: Math.max(60, workSeconds) },
    finishedWork: false,
    elapsedWorkMinutes: 0,
  };
}

export function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
