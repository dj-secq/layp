import { usePhone } from "@/state/phone";
import { loadSession } from "@/link/store";
import { colors, onPrimary, primary } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, useColorScheme, View } from "react-native";

export default function PairScreen() {
  useColorScheme();
  usePaper();
  const phone = usePhone();
  const router = useRouter();
  const params = useLocalSearchParams<{ address?: string | string[] }>();
  const address = Array.isArray(params.address) ? params.address[0] : params.address;
  const showAddress = phone.hasKey && address === "1";

  if (!phone.ready) return <Message text="Opening the database…" />;
  if (phone.bootError) return <Message text={phone.bootError} />;
  if (phone.hasKey && !showAddress) return <Redirect href="/today" />;
  if (showAddress) return <AddressForm onDone={() => router.replace("/today")} />;
  return <PairForm />;
}

function PairForm() {
  useColorScheme();
  usePaper();
  const phone = usePhone();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("Phone");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const message = await phone.pair(code, name);
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    router.replace("/today");
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Title>Layp</Stack.Title>
      <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16 }}>
        Paste the full code from the computer.
      </Text>
      <Field label="Code" value={code} onChangeText={setCode} autoCapitalize="characters" />
      <Field label="Name" value={name} onChangeText={setName} />
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      <PrimaryButton label={pending ? "Pairing…" : "Pair"} disabled={pending} onPress={() => void submit()} />
    </ScrollView>
  );
}

function AddressForm({ onDone }: { onDone: () => void }) {
  useColorScheme();
  usePaper();
  const phone = usePhone();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSession().then((session) => {
      if (cancelled || !session) return;
      setHost(session.host);
      setPort(String(session.port));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    setPending(true);
    setError(null);
    const message = await phone.replaceHost(host, port);
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    onDone();
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16 }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Title>Computer</Stack.Title>
      <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16 }}>
        The pairing key stays on this phone.
      </Text>
      <Field label="Host" value={host} onChangeText={setHost} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
      <Field label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" />
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      <PrimaryButton label={pending ? "Saving…" : "Save address"} disabled={pending} onPress={() => void submit()} />
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  autoCapitalize = "none",
  keyboardType = "default",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoCapitalize?: "none" | "characters";
  keyboardType?: "default" | "number-pad" | "numbers-and-punctuation";
}) {
  useColorScheme();
  usePaper();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
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
    </View>
  );
}

function PrimaryButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
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
      <Text style={{ color: onPrimary, fontSize: 17, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function Message({ text }: { text: string }) {
  useColorScheme();
  usePaper();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: "center" }}>
      <Text selectable style={{ color: colors.label, fontSize: 17 }}>{text}</Text>
    </View>
  );
}
