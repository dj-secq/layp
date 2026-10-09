import { Pressable, Text, View, useColorScheme } from "react-native";
import { colors, ink, primary } from "../theme/colors";

export function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  useColorScheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={{
                backgroundColor: selected ? primary : colors.grouped,
                borderRadius: 12,
                borderCurve: "continuous",
                paddingHorizontal: 12,
                paddingVertical: 8,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <Text style={{ color: selected ? ink : colors.label, fontSize: 16 }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
