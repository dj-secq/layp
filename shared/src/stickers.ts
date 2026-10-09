export const STICKERS = [
  { name: "yellow", hex: "#ffdc58" },
  { name: "coral", hex: "#ff6b6b" },
  { name: "sky", hex: "#7dd3fc" },
  { name: "mint", hex: "#86efac" },
  { name: "lavender", hex: "#c4b5fd" },
  { name: "orange", hex: "#fdba74" },
  { name: "pink", hex: "#f9a8d4" },
  { name: "lime", hex: "#bef264" },
  { name: "sand", hex: "#f3d5a0" },
  { name: "rose", hex: "#fda4af" },
  { name: "aqua", hex: "#99f6e4" },
  { name: "grape", hex: "#d8b4fe" },
  { name: "peach", hex: "#fed7aa" },
  { name: "denim", hex: "#93c5fd" },
] as const;

export const DEFAULT_LIST_COLOR = "#ffdc58";

export const MOOD_COLORS = ["#ff6b6b", "#fdba74", "#ffdc58", "#7dd3fc", "#86efac"] as const;

export function stickerName(hex: string): string {
  return STICKERS.find((sticker) => sticker.hex === hex.toLowerCase())?.name ?? "color";
}
