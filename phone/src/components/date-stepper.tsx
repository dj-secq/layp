import { colors, ink, onPrimary, primary } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { Pressable, Text, View, useColorScheme } from "react-native";

const BOX = 40;
const TODAY_WIDTH = 72;

export function DateStepper({
  label,
  onLabelPress,
  onPrevious,
  onNext,
  onToday,
}: {
  label: string;
  onLabelPress?: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday?: () => void;
}) {
  useColorScheme();
  usePaper();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Arrow label="Previous" direction="left" onPress={onPrevious} />
      <Pressable
        accessibilityRole={onLabelPress ? "button" : undefined}
        disabled={!onLabelPress}
        onPress={onLabelPress}
        style={{ flex: 1, minWidth: 0, minHeight: BOX, justifyContent: "center" }}
      >
        <Text numberOfLines={1} style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>
          {label}
        </Text>
      </Pressable>
      <Arrow label="Next" direction="right" onPress={onNext} />
      {onToday ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Today"
          onPress={onToday}
          style={{
            width: TODAY_WIDTH,
            height: BOX,
            borderRadius: 8,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: ink,
            backgroundColor: primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: onPrimary, fontSize: 15, fontWeight: "600" }}>Today</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Arrow({ label, direction, onPress }: { label: string; direction: "left" | "right"; onPress: () => void }) {
  useColorScheme();
  usePaper();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: BOX,
        height: BOX,
        borderRadius: 8,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: ink,
        backgroundColor: colors.grouped,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 9,
          height: 9,
          borderTopWidth: 2,
          borderColor: ink,
          ...(direction === "left" ? { borderLeftWidth: 2 } : { borderRightWidth: 2 }),
          transform: [{ rotate: direction === "left" ? "-45deg" : "45deg" }],
        }}
      />
    </Pressable>
  );
}
