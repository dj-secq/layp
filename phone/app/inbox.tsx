import { PrimaryButton } from "@/components/primary-button";
import { TaskRow } from "@/components/task-row";
import { Field } from "@/components/field";
import { addInboxTitle, addQuick, loadInbox, type InboxSnapshot } from "@/db/tasks";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { todayIso } from "@layp/shared";
import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, useColorScheme, View } from "react-native";

export default function InboxScreen() {
  useColorScheme();
  const phone = usePhone();
  const [data, setData] = useState<InboxSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState("");
  const [quick, setQuick] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void loadInbox().then(
      (next) => {
        if (cancel) return;
        setData(next);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load Inbox.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;

  async function addTitle() {
    setPending(true);
    const result = await addInboxTitle(title);
    setPending(false);
    if (result.status === "saved") {
      setTitle("");
      setMessage(null);
      phone.changed();
      return;
    }
    setMessage(result.status === "error" ? result.message : "Not saved");
  }

  async function addLine() {
    const now = new Date();
    setPending(true);
    const result = await addQuick(quick, { today: todayIso(), minutes: now.getHours() * 60 + now.getMinutes() });
    setPending(false);
    if (result.status === "empty") return;
    if (result.status === "saved") {
      setQuick("");
      setMessage(result.notice);
      phone.changed();
      return;
    }
    setMessage(result.message);
  }

  const tasks = data?.tasks ?? [];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Title>Inbox</Stack.Title>
      {data === null && !error ? <Text style={{ color: colors.label }}>Loading Inbox…</Text> : null}
      {error && data === null ? (
        <View style={{ gap: 12 }}>
          <Text selectable style={{ color: colors.label }}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}>
            <Text style={{ color: colors.label, fontSize: 17 }}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {data && tasks.length === 0 ? <Text style={{ color: colors.label, fontSize: 17 }}>Nothing in Inbox.</Text> : null}
      {tasks.length > 0 ? (
        <View style={{ backgroundColor: colors.grouped, borderRadius: 16, borderCurve: "continuous", paddingHorizontal: 12 }}>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              detail={data?.sections.find((section) => section.id === task.sectionId)?.name}
              onComplete={(id) => void phone.complete(id)}
            />
          ))}
        </View>
      ) : null}
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Add to Inbox" />
      <PrimaryButton label={pending ? "Saving…" : "Add"} disabled={pending} onPress={() => void addTitle()} />
      <Field label="Quick add" value={quick} onChangeText={setQuick} placeholder="gym friday 6pm" autoCapitalize="none" />
      <PrimaryButton label={pending ? "Saving…" : "Add line"} disabled={pending} onPress={() => void addLine()} />
      {message ? <Text selectable style={{ color: colors.label }}>{message}</Text> : null}
    </ScrollView>
  );
}

function Centered({ text }: { text: string }) {
  useColorScheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: "center" }}>
      <Text selectable style={{ color: colors.label, fontSize: 17 }}>{text}</Text>
    </View>
  );
}
