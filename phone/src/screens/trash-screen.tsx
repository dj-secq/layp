import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import { emptyTrash, purgeTask, restoreTask, trashedTasks } from "@/db/task-extra";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import type { Task } from "@layp/shared";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

export function TrashScreen() {
  usePaper();
  const phone = usePhone();
  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  return (
    <ScreenScroll>
      <LaypTitle>Trash</LaypTitle>
      <TrashList />
    </ScreenScroll>
  );
}

export function TrashList() {
  const phone = usePhone();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void trashedTasks().then(
      (rows) => {
        if (!cancel) {
          setTasks(rows);
          setError(null);
        }
      },
      () => {
        if (!cancel) setError("Could not load trash.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision]);

  async function restore(id: string) {
    const result = await restoreTask(id);
    if (result.status === "saved") phone.changed();
    else setError(result.status === "error" ? result.message : "Not saved");
  }

  async function purge(id: string) {
    const result = await purgeTask(id);
    if (result.status === "saved") phone.changed();
    else setError(result.status === "error" ? result.message : "Not saved");
  }

  async function empty() {
    const result = await emptyTrash();
    setConfirmEmpty(false);
    if (result.status === "saved") phone.changed();
    else setError(result.status === "error" ? result.message : "Not saved");
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Trash</Text>
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {tasks === null ? <Text style={{ color: colors.label }}>Loading trash…</Text> : null}
      {tasks && tasks.length > 0 ? <TextButton label="Empty trash" onPress={() => setConfirmEmpty(true)} /> : null}
      {tasks?.length === 0 ? <Text style={{ color: colors.label, fontSize: 16 }}>Trash is empty.</Text> : null}
      {(tasks ?? []).map((task) => (
        <View key={task.id} style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
          <Text style={{ color: colors.label, fontSize: 17 }}>{task.title}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <TextButton label="Restore" onPress={() => void restore(task.id)} />
            <TextButton label="Delete permanently" onPress={() => void purge(task.id)} />
          </View>
        </View>
      ))}
      {confirmEmpty ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.label, fontSize: 16 }}>This permanently deletes every task in the trash.</Text>
          <View style={{ flexDirection: "row" }}>
            <TextButton label="Empty trash" onPress={() => void empty()} />
            <TextButton label="Cancel" onPress={() => setConfirmEmpty(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
