import { loadSession } from "@/link/store";
import { usePhone } from "@/state/phone";
import { useEffect, useState } from "react";
import { Text, useColorScheme } from "react-native";
import { colors } from "../theme/colors";
import { usePaper } from "../theme/theme";
import { Field } from "./field";
import { PrimaryButton } from "./primary-button";

export function AddressForm({ onDone }: { onDone: () => void }) {
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
    <>
      <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16 }}>
        The pairing key stays on this phone.
      </Text>
      <Field label="Host" value={host} onChangeText={setHost} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
      <Field label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" autoCapitalize="none" />
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      <PrimaryButton label={pending ? "Saving…" : "Save address"} disabled={pending} onPress={() => void submit()} />
    </>
  );
}
