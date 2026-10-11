import { Text, TextInput, View, useColorScheme } from "react-native";
import { colors } from "../theme/colors";
import { usePaper } from "../theme/theme";

export function Field({
  label,
  value,
  onChangeText,
  onBlur,
  onFocus,
  placeholder,
  multiline = false,
  maxLength,
  keyboardType = "default",
  autoCapitalize = "sentences",
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: "default" | "decimal-pad" | "number-pad" | "numbers-and-punctuation";
  autoCapitalize?: "none" | "sentences" | "characters";
  autoFocus?: boolean;
}) {
  useColorScheme();
  usePaper();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.secondaryLabel}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoFocus={autoFocus}
        autoCorrect={false}
        style={{
          color: colors.label,
          backgroundColor: colors.grouped,
          borderRadius: 12,
          borderCurve: "continuous",
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 17,
          minHeight: multiline ? 120 : undefined,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}
