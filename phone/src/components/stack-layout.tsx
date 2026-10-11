import { screenChrome } from "@/theme/chrome";
import { usePaper } from "@/theme/theme";
import { Stack } from "expo-router/stack";

export function TabStack() {
  const paper = usePaper();
  return <Stack screenOptions={screenChrome(paper)} />;
}
