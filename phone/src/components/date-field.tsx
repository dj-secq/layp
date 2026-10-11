import { cleanDate, todayIso, type WeekStart } from "@layp/shared";
import { useState } from "react";
import { View } from "react-native";
import { Field } from "./field";
import { MonthGrid } from "./month-grid";
import { TextButton } from "./text-button";

/** A typed civil date, with the in-app month grid when the text is not enough. */
export function DateField({
  label,
  value,
  weekStart,
  onChange,
}: {
  label: string;
  value: string;
  weekStart: WeekStart;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = cleanDate(value) ?? todayIso();
  return (
    <View style={{ gap: 8 }}>
      <Field label={label} value={value} placeholder="YYYY-MM-DD" autoCapitalize="none" onChangeText={onChange} />
      <TextButton label={open ? "Hide calendar" : "Pick a date"} onPress={() => setOpen((current) => !current)} />
      {open ? (
        <MonthGrid
          value={picked}
          weekStart={weekStart}
          onPick={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}
