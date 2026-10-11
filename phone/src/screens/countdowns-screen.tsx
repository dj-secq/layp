import { DateField } from "@/components/date-field";
import { Field } from "@/components/field";
import { PrimaryButton } from "@/components/primary-button";
import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import { createCountdown, deleteCountdown, loadCountdowns, updateCountdown, type Countdown } from "@/db/countdowns";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { countdownLabel, todayIso } from "@layp/shared";
import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

export function CountdownsScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const today = todayIso();
  const [rows, setRows] = useState<Countdown[] | null>(null);
  const [editor, setEditor] = useState<Countdown | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void loadCountdowns().then(
      (next) => {
        if (cancel) return;
        setRows(next);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load countdowns.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && rows === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  async function remove(id: string) {
    const result = await deleteCountdown(id);
    if (result.status === "saved") phone.changed();
    else setError(result.message);
  }

  return (
    <ScreenScroll>
      <Stack.Title>Countdowns</Stack.Title>
      <TextButton label={editor ? "Close" : "Add countdown"} onPress={() => setEditor(editor ? null : "new")} />
      {editor ? (
        <CountdownForm
          initial={editor === "new" ? null : editor}
          weekStart={settings.weekStart}
          today={today}
          onCancel={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            phone.changed();
          }}
        />
      ) : null}
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {rows === null ? <Text style={{ color: colors.label }}>Loading countdowns…</Text> : null}
      {rows?.length === 0 ? <Text style={{ color: colors.label, fontSize: 16 }}>No countdowns yet.</Text> : null}
      {(rows ?? []).map((row) => (
        <View key={row.id} style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
          <Text style={{ color: colors.label, fontSize: 17 }}>
            {row.title} · {countdownLabel(row.targetOn, today)}
          </Text>
          <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>{row.targetOn}</Text>
          <View style={{ flexDirection: "row" }}>
            <TextButton label="Edit" onPress={() => setEditor(row)} />
            <TextButton label="Delete" onPress={() => void remove(row.id)} />
          </View>
        </View>
      ))}
    </ScreenScroll>
  );
}

function CountdownForm({
  initial,
  weekStart,
  today,
  onCancel,
  onSaved,
}: {
  initial: Countdown | null;
  weekStart: "monday" | "sunday";
  today: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.targetOn ?? today);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const result = initial ? await updateCountdown(initial, title, date) : await createCountdown(title, date);
    if (result.status !== "saved") {
      setError(result.message);
      return;
    }
    onSaved();
  }

  return (
    <View style={{ gap: 12 }}>
      <Field label="Countdown" value={title} maxLength={80} onChangeText={setTitle} />
      <DateField label="Date" value={date} weekStart={weekStart} onChange={setDate} />
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      <PrimaryButton label={initial ? "Save" : "Add countdown"} onPress={() => void save()} />
      <TextButton label="Cancel" onPress={onCancel} />
    </View>
  );
}
