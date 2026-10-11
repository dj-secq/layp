import { Stack, router } from "expo-router";

/** Header button on the tab screens. Search is a root screen, not a sixth tab. */
export function HeaderSearch() {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button onPress={() => router.push("/search")}>Search</Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
