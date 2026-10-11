import { PrimaryButton } from "@/components/primary-button";
import { addQuick, recentTaskTitles } from "@/db/tasks";
import { loadLists } from "@/db/lists";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { previewQuickAdd, suggestQuickAdd, todayIso, type QuickList } from "@layp/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

function one(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

export default function AddSheet() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const params = useLocalSearchParams<{ listId?: string | string[]; day?: string | string[] }>();
  const listId = one(params.listId);
  const day = one(params.day);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lists, setLists] = useState<QuickList[]>([]);
  const [recentTitles, setRecentTitles] = useState<string[]>([]);

  useEffect(() => {
    if (!phone.ready) return;
    let cancel = false;
    void Promise.all([loadLists(), recentTaskTitles()]).then(
      ([loaded, titles]) => {
        if (cancel) return;
        setLists(loaded.map((list) => ({ id: list.id, name: list.name })));
        setRecentTitles(titles);
      },
      () => undefined,
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.revision]);

  const now = new Date();
  const quickNow = { today: todayIso(), minutes: now.getHours() * 60 + now.getMinutes() };
  const preview = previewQuickAdd(text, lists, quickNow, settings.clock);
  const suggestions = suggestQuickAdd(text, { lists, recentTitles, snippets: settings.quickSnippets }, quickNow);

  async function save() {
    setPending(true);
    const result = await addQuick(
      text,
      { today: todayIso(), minutes: new Date().getHours() * 60 + new Date().getMinutes() },
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
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 20, gap: 12 }}
    >
      <Text style={{ color: colors.label, fontSize: 20, fontWeight: "600" }}>Add</Text>
      <TextInput
        autoFocus
        value={text}
        onChangeText={(value) => {
          setText(value);
          setMessage(null);
        }}
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
      {preview ? <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>{preview}</Text> : null}
      <View style={{ gap: 8 }}>
        {suggestions.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={row.detail ? `${row.label}, ${row.detail}` : row.label}
            onPress={() => {
              setText(row.next);
              setMessage(null);
            }}
            style={{
              backgroundColor: colors.grouped,
              borderRadius: 12,
              borderCurve: "continuous",
              paddingHorizontal: 14,
              paddingVertical: 10,
              gap: 2,
            }}
          >
            <Text style={{ color: colors.label, fontSize: 16 }}>{row.label}</Text>
            {row.detail ? <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{row.detail}</Text> : null}
          </Pressable>
        ))}
      </View>
      <PrimaryButton label={pending ? "Saving…" : "Add"} disabled={pending} onPress={() => void save()} />
      {message ? <Text selectable style={{ color: colors.label }}>{message}</Text> : null}
    </ScrollView>
  );
}
