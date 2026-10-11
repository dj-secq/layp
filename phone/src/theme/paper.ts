export const themeNames = ["light", "dark", "dusk", "ink", "sage", "sea", "bloom", "slate"] as const;
export type ThemeName = (typeof themeNames)[number];

export function isThemeName(value: string | undefined): value is ThemeName {
  return themeNames.some((name) => name === value);
}

export type Scheme = "light" | "dark";

export type Paper = {
  name: ThemeName;
  title: string;
  scheme: Scheme;
  ink: string;
  secondary: string;
  background: string;
  grouped: string;
  separator: string;
  border: string;
  muted: string;
  danger: string;
  warning: string;
};

/**
 * Same table as the desktop theme in app/src/index.css.
 * background is canvas, grouped is surface, secondary is ink-soft.
 */
export const papers: Record<ThemeName, Paper> = {
  light: {
    name: "light",
    title: "Light",
    scheme: "light",
    ink: "#2c2824",
    secondary: "#4e4840",
    background: "#f4f1ea",
    grouped: "#fffcf8",
    separator: "#e3dcd0",
    border: "#e3dcd0",
    muted: "#ebe4d6",
    danger: "#e63946",
    warning: "#ff9f1c",
  },
  dark: {
    name: "dark",
    title: "Dark",
    scheme: "dark",
    ink: "#f4efe6",
    secondary: "#b7b0a4",
    background: "#1c1b19",
    grouped: "#282623",
    separator: "rgba(244,239,230,0.24)",
    border: "rgba(244,239,230,0.24)",
    muted: "#32302c",
    danger: "#ff6b6b",
    warning: "#ffb020",
  },
  dusk: {
    name: "dusk",
    title: "Dusk",
    scheme: "dark",
    ink: "#f6efe4",
    secondary: "#ddd4c8",
    background: "#2a2420",
    grouped: "#362e28",
    separator: "rgba(246,239,228,0.28)",
    border: "rgba(246,239,228,0.28)",
    muted: "#40362f",
    danger: "#ff6b6b",
    warning: "#ffb020",
  },
  ink: {
    name: "ink",
    title: "Ink",
    scheme: "dark",
    ink: "#e7eef4",
    secondary: "#a8b6c4",
    background: "#1a2128",
    grouped: "#24303a",
    separator: "rgba(231,238,244,0.32)",
    border: "rgba(231,238,244,0.32)",
    muted: "#2d3b48",
    danger: "#ff6b6b",
    warning: "#ffb020",
  },
  sage: {
    name: "sage",
    title: "Sage",
    scheme: "light",
    ink: "#243028",
    secondary: "#4d5c52",
    background: "#e7efe6",
    grouped: "#f7fbf6",
    separator: "#d3dfd2",
    border: "#d3dfd2",
    muted: "#dce8db",
    danger: "#e63946",
    warning: "#ff9f1c",
  },
  sea: {
    name: "sea",
    title: "Sea",
    scheme: "light",
    ink: "#1d2c36",
    secondary: "#4a6270",
    background: "#e5eef2",
    grouped: "#f5fafc",
    separator: "#d0dee6",
    border: "#d0dee6",
    muted: "#d7e6ee",
    danger: "#e63946",
    warning: "#ff9f1c",
  },
  bloom: {
    name: "bloom",
    title: "Bloom",
    scheme: "light",
    ink: "#3a2a28",
    secondary: "#6d534e",
    background: "#f8eee9",
    grouped: "#fff8f5",
    separator: "#ead9d2",
    border: "#ead9d2",
    muted: "#f0e0d8",
    danger: "#e63946",
    warning: "#ff9f1c",
  },
  slate: {
    name: "slate",
    title: "Slate",
    scheme: "light",
    ink: "#24282e",
    secondary: "#555c66",
    background: "#e8eaee",
    grouped: "#f7f8fa",
    separator: "#d5d8df",
    border: "#d5d8df",
    muted: "#dee1e8",
    danger: "#e63946",
    warning: "#ff9f1c",
  },
};

export const primary = "#ffdc58";
export const onPrimary = "#111111";
