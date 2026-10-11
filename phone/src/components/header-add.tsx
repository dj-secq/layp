import { Stack, router } from "expo-router";

/** Header button that opens the shared quick-add sheet. */
export function HeaderAdd({ listId, day }: { listId?: string; day?: string }) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        onPress={() =>
          router.push({
            pathname: "/add",
            params: {
              ...(listId ? { listId } : {}),
              ...(day ? { day } : {}),
            },
          })
        }
      >
        Add
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
