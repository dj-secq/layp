import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import { loadArchivedLists, purgeList, restoreList } from "@/db/lists";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import type { TaskList } from "@layp/shared";
import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

export function ArchiveScreen() {
  usePaper();
  const phone = usePhone();
  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  return (
    <ScreenScroll>
      <Stack.Title>Archive</Stack.Title>
      <ArchiveList />
    </ScreenScroll>
  );
}

export function ArchiveList() {
  const phone = usePhone();
  const [rows, setRows] = useState<TaskList[] | null>(null);
  const [pending, setPending] = useState<TaskList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void loadArchivedLists().then(
      (lists) => {
        if (!cancel) {
          setRows(lists);
          setError(null);
        }
      },
      () => {
        if (!cancel) setError("Could not load the archive.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision]);

  async function restore(list: TaskList) {
    const result = await restoreList(list);
    if (result.status === "saved") phone.changed();
    else setError(result.status === "error" ? result.message : "Not saved");
  }

  async function remove(list: TaskList) {
    const result = await purgeList(list);
    if (result.status === "saved") {
      setPending(null);
      phone.changed();
    } else setError(result.status === "error" ? result.message : "Not saved");
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Archive</Text>
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {rows === null ? <Text style={{ color: colors.label }}>Loading the archive…</Text> : null}
      {rows?.length === 0 ? <Text style={{ color: colors.label, fontSize: 16 }}>No archived lists.</Text> : null}
      {(rows ?? []).map((list) => (
        <View key={list.id} style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
          <Text style={{ color: colors.label, fontSize: 17 }}>{list.name}</Text>
          <View style={{ flexDirection: "row" }}>
            <TextButton label="Restore" onPress={() => void restore(list)} />
            <TextButton label="Delete list" onPress={() => setPending(list)} />
          </View>
        </View>
      ))}
      {pending ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.label, fontSize: 16 }}>This permanently deletes {pending.name} and every task on it.</Text>
          <View style={{ flexDirection: "row" }}>
            <TextButton label="Delete list" onPress={() => void remove(pending)} />
            <TextButton label="Cancel" onPress={() => setPending(null)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
