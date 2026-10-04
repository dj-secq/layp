import { CHIME_GAP_SECONDS, CHIME_PLAYS, type FocusSound } from "./focusSound";

const FILES: Record<Exclude<FocusSound, "none">, string> = {
  soft: "/sounds/soft.wav",
  bell: "/sounds/bell.wav",
  click: "/sounds/click.wav",
};

let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

function ensure(): AudioContext | null {
  if (context) return context;
  const Ctx = window.AudioContext;
  if (!Ctx) return null;
  try {
    context = new Ctx();
  } catch {
    context = null;
  }
  return context;
}

function load(ctx: AudioContext, id: Exclude<FocusSound, "none">): Promise<AudioBuffer> {
  const existing = buffers.get(id);
  if (existing) return existing;
  const pending = fetch(FILES[id])
    .then((response) => response.arrayBuffer())
    .then((bytes) => ctx.decodeAudioData(bytes));
  buffers.set(id, pending);
  return pending;
}

/** Call from a click or key so later phase-end playback is allowed. */
export function unlockChime(): void {
  const ctx = ensure();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  void load(ctx, "soft").catch(() => undefined);
  void load(ctx, "bell").catch(() => undefined);
  void load(ctx, "click").catch(() => undefined);
}

export async function playChime(id: Exclude<FocusSound, "none">): Promise<void> {
  const ctx = context;
  if (!ctx || ctx.state !== "running") return;
  try {
    const buffer = await load(ctx, id);
    const gap = CHIME_GAP_SECONDS;
    for (let play = 0; play < CHIME_PLAYS; play += 1) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(ctx.currentTime + play * gap);
    }
  } catch {
    // A missing clip leaves the timer running. The failure is not logged.
  }
}
