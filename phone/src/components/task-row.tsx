import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { colors, ink, primary } from "../theme/colors";

type RowTask = {
  id: string;
  title: string;
  completedAt: string | null;
  sectionName?: string | null;
  tagNames?: string[];
};

export function TaskRow({ task, detail, onComplete }: { task: RowTask; detail?: string; onComplete: (id: string) => void }) {
  const done = task.completedAt !== null;
  const line = detail ?? [task.sectionName, ...(task.tagNames ?? [])].filter((part) => part && part.length > 0).join(" · ");
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 10 }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        disabled={done}
        onPress={() => onComplete(task.id)}
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          borderCurve: "continuous",
          borderWidth: 1.5,
          borderColor: colors.separator,
          backgroundColor: done ? primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done ? <Text style={{ color: ink, fontSize: 16 }}>✓</Text> : null}
      </Pressable>
      <Link href={{ pathname: "/task/[id]", params: { id: task.id } }} asChild>
        <Pressable style={{ flex: 1, gap: 2 }}>
          <Text selectable style={{ color: colors.label, fontSize: 17, textDecorationLine: done ? "line-through" : "none" }}>
            {task.title}
          </Text>
          {line ? (
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
              {line}
            </Text>
          ) : null}
        </Pressable>
      </Link>
    </View>
  );
}
