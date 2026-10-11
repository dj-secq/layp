import { boldFamily } from "@/theme/fonts";
import { usePaper } from "@/theme/theme";
import { Stack } from "expo-router";

/** Screen title in Space Grotesk 700, the same face as the desktop page title. */
export function LaypTitle({ children }: { children: string }) {
  const paper = usePaper();
  return (
    <Stack.Title
      style={{
        fontFamily: boldFamily,
        fontSize: 22,
        fontWeight: "400",
        color: paper.ink,
      }}
    >
      {children}
    </Stack.Title>
  );
}
