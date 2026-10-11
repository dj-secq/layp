import { PrimaryButton } from "@/components/primary-button";
import { addQuick } from "@/db/tasks";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { todayIso } from "@layp/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

function one(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

export default function AddSheet() {
  usePaper();
  const phone = usePhone();
  const params = useLocalSearchParams<{ listId?: string | string[]; day?: string | string[] }>();
  const listId = one(params.listId);
  const day = one(params.day);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const now = new Date();
    setPending(true);
    const result = await addQuick(
      text,
      { today: todayIso(), minutes: now.getHours() * 60 + now.getMinutes() },
      { listId, dueOn: day && day !== todayIso() ? day : null },
    );
    setPending(false);
    if (result.status === "empty") return;
    if (result.status === "saved") {
      phone.changed();
      router.back();
      return;
    }
    setMessage(result.message);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, gap: 12 }}>
      <Text style={{ color: colors.label, fontSize: 20, fontWeight: "600" }}>Add</Text>
      <TextInput
        autoFocus
        value={text}
        onChangeText={setText}
        placeholder="gym friday 6pm"
        placeholderTextColor={colors.secondaryLabel}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={() => void save()}
        style={{
          color: colors.label,
          backgroundColor: colors.grouped,
          borderRadius: 12,
          borderCurve: "continuous",
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 17,
        }}
      />
      <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>p1, friday 6pm, every friday, in School</Text>
      <PrimaryButton label={pending ? "Saving…" : "Add"} disabled={pending} onPress={() => void save()} />
      {message ? <Text selectable style={{ color: colors.label }}>{message}</Text> : null}
    </View>
  );
}
