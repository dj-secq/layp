import { Field } from "@/components/field";
import { ScreenScroll } from "@/components/screen";
import { searchAll, type DayHit, type SearchHit } from "@/db/search";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { formatDay } from "@layp/shared";
import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

export function SearchScreen() {
  usePaper();
  const phone = usePhone();
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState<SearchHit[]>([]);
  const [days, setDays] = useState<DayHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();

  useEffect(() => {
    if (!phone.ready || !trimmed) {
      setTasks([]);
      setDays([]);
      setError(null);
      return;
    }
    let cancel = false;
    const handle = setTimeout(() => {
      void searchAll(trimmed).then(
        (result) => {
          if (cancel) return;
          setTasks(result.tasks);
          setDays(result.days);
          setError(null);
        },
        () => {
          if (!cancel) setError("Could not search.");
        },
      );
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(handle);
    };
  }, [phone.ready, trimmed]);

  const quiet = trimmed.length === 0;
  const none = !quiet && tasks.length === 0 && days.length === 0 && !error;

  return (
    <ScreenScroll search={false}>
      <Stack.Title>Search</Stack.Title>
      <Field label="Search" value={text} placeholder="Tasks, notes, diary" autoCapitalize="none" autoFocus onChangeText={setText} />
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {none ? <Text style={{ color: colors.label, fontSize: 16 }}>No matches.</Text> : null}
      {tasks.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Tasks</Text>
          {tasks.map((task) => (
            <Pressable
              key={task.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text style={{ color: colors.label, fontSize: 17 }}>{task.title}</Text>
              <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>{task.listName}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {days.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Days</Text>
          {days.map((day) => (
            <Pressable
              key={day.day}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/today", params: { date: day.day } })}
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text style={{ color: colors.label, fontSize: 17 }}>{formatDay(day.day)}</Text>
              <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>{day.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScreenScroll>
  );
}
