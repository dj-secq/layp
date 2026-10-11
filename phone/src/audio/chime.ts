import { CHIME_GAP_SECONDS, CHIME_PLAYS, type FocusSound } from "@layp/shared";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

const sources: Record<Exclude<FocusSound, "none">, number> = {
  bell: require("../../assets/sounds/bell.wav"),
  click: require("../../assets/sounds/click.wav"),
  soft: require("../../assets/sounds/soft.wav"),
};

let generation = 0;
let player: AudioPlayer | null = null;
let armed = false;

/** Replay the desktop clip. A phase that ends on its own strikes eight times. */
export function playChime(clip: Exclude<FocusSound, "none">): void {
  generation += 1;
  const token = generation;
  if (!armed) {
    armed = true;
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }
  player?.remove();
  const next = createAudioPlayer(sources[clip]);
  player = next;
  let played = 0;
  const strike = () => {
    if (token !== generation) return;
    void next.seekTo(0).then(() => {
      if (token !== generation) return;
      next.play();
    });
    played += 1;
    if (played >= CHIME_PLAYS) return;
    setTimeout(strike, CHIME_GAP_SECONDS * 1000);
  };
  strike();
}
