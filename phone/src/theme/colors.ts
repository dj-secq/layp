import { Color } from "expo-router";
import { Platform } from "react-native";

export const colors = {
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: "#2c2824",
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: "#5c564e",
  })!,
  background: Platform.select({
    ios: Color.ios.systemBackground,
    android: Color.android.dynamic.surface,
    default: "#f4f1ea",
  })!,
  grouped: Platform.select({
    ios: Color.ios.secondarySystemBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: "#fffcf8",
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: "#e4ddd2",
  })!,
};

export const ink = "#2c2824";
export const primary = "#ffdc58";
