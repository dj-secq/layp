import { Pressable, Text } from "react-native";
import { colors } from "../theme/colors";
import { usePaper } from "../theme/theme";

export function TextButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  usePaper();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 8, opacity: disabled ? 0.4 : 1 }}
    >
      <Text style={{ color: colors.label, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}
