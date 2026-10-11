import { colors, ink, onPrimary, primary } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { monthCells, monthLabel, shiftMonth, todayIso, weekdayLabels, type WeekStart } from "@layp/shared";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { DateStepper } from "./date-stepper";

export function MonthGrid({
  value,
  weekStart,
  marks = {},
  onPick,
}: {
  value: string;
  weekStart: WeekStart;
  marks?: Record<string, string[]>;
  onPick: (iso: string) => void;
}) {
  usePaper();
  const initial = value.slice(0, 7);
  const [year, setYear] = useState(Number(initial.slice(0, 4)));
  const [month, setMonth] = useState(Number(initial.slice(5, 7)));
  const cells = monthCells(year, month, weekStart);
  const today = todayIso();

  function shift(delta: number) {
    const next = shiftMonth(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  }

  return (
    <View style={{ gap: 8 }}>
      <DateStepper label={monthLabel(year, month)} onPrevious={() => shift(-1)} onNext={() => shift(1)} />
      <View style={{ flexDirection: "row" }}>
        {weekdayLabels(weekStart).map((label) => (
          <Text key={label} style={{ width: "14.28%", textAlign: "center", color: colors.secondaryLabel, fontSize: 12 }}>
            {label.slice(0, 2)}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((iso, index) => {
          if (!iso) return <View key={`blank-${index}`} style={{ width: "14.28%", minHeight: 44 }} />;
          const selected = iso === value;
          const colorsForDay = marks[iso] ?? [];
          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onPick(iso)}
              style={{
                width: "14.28%",
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                backgroundColor: selected ? primary : "transparent",
                borderWidth: iso === today ? 1.5 : 0,
                borderColor: ink,
              }}
            >
              <Text style={{ color: selected ? onPrimary : colors.label, fontSize: 15 }}>{Number(iso.slice(-2))}</Text>
              <View style={{ flexDirection: "row", gap: 2, height: 6, marginTop: 2 }}>
                {colorsForDay.slice(0, 3).map((color, dot) => (
                  <View key={`${iso}-${dot}`} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
