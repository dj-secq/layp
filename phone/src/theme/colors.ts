import { onPrimary as inkOnPrimary, papers, type Paper } from "./paper";

/** Mutated by `usePaper` so existing screens pick up the synced theme on the next render. */
export const colors = {
  label: papers.light.ink,
  secondaryLabel: papers.light.secondary,
  background: papers.light.background,
  grouped: papers.light.grouped,
  separator: papers.light.separator,
  muted: papers.light.muted,
  danger: papers.light.danger,
  warning: papers.light.warning,
};

export let ink = papers.light.ink;
export const primary = "#ffdc58";
/** Text and icons on the yellow primary fill. Stays #111111 in every theme. */
export const onPrimary = inkOnPrimary;

export function paint(paper: Paper): void {
  colors.label = paper.ink;
  colors.secondaryLabel = paper.secondary;
  colors.background = paper.background;
  colors.grouped = paper.grouped;
  colors.separator = paper.separator;
  colors.muted = paper.muted;
  colors.danger = paper.danger;
  colors.warning = paper.warning;
  ink = paper.ink;
}
