export const focusSounds = ["none", "soft", "bell", "click"] as const;
export type FocusSound = (typeof focusSounds)[number];

export const CHIME_PLAYS = 8;
/** Seconds from one strike to the next. Eight strikes last about nine seconds. */
export const CHIME_GAP_SECONDS = 1.15;

export function parseFocusSound(value: string | undefined): FocusSound {
  if (value === "none" || value === "soft" || value === "bell" || value === "click") return value;
  return "bell";
}

/** A clip plays only when a phase ends because the timer reached zero. */
export function clipForTransition(
  ended: "work" | "break",
  sounds: { work: FocusSound; break: FocusSound },
  because: "elapsed" | "skip" | "cancel" | "pause",
): Exclude<FocusSound, "none"> | null {
  if (because !== "elapsed") return null;
  const chosen = ended === "work" ? sounds.work : sounds.break;
  return chosen === "none" ? null : chosen;
}

/** How many times the clip plays. Zero unless the phase ended on its own. */
export function chimePlays(
  ended: "work" | "break",
  sounds: { work: FocusSound; break: FocusSound },
  because: "elapsed" | "skip" | "cancel" | "pause",
): number {
  return clipForTransition(ended, sounds, because) ? CHIME_PLAYS : 0;
}
