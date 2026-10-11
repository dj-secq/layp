import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { usePaper } from "../theme/theme";
import { HeaderSearch } from "./header-search";

export function ScreenScroll({ children, search = true }: { children: ReactNode; search?: boolean }) {
  usePaper();
  return (
    <>
      {search ? <HeaderSearch /> : null}
      <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 32 }}
    >
      {children}
    </ScrollView>
    </>
  );
}

export function Centered({ text, action }: { text: string; action?: () => void }) {
  usePaper();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: "center", gap: 12 }}>
      <Text selectable style={{ color: colors.label, fontSize: 17 }}>{text}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action}>
          <Text style={{ color: colors.label, fontSize: 17 }}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
