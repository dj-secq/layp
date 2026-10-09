import { Pressable, Text } from "react-native";
import { ink, primary } from "../theme/colors";

export function PrimaryButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: primary,
        borderRadius: 14,
        borderCurve: "continuous",
        paddingVertical: 14,
        alignItems: "center",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={{ color: ink, fontSize: 17, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
