import {
  describeRule,
  draftFromRule,
  parseRule,
  recurrenceDraftError,
  recurrenceSave,
  type RecurrenceDraft,
  type RecurrenceRule,
  type Task,
  type WeekdayCode,
} from "@layp/shared";
import { useState } from "react";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { colors, ink, primary } from "../theme/colors";
import { Choice } from "./choice";
import { Field } from "./field";

const WEEKDAYS: { code: WeekdayCode; label: string }[] = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
];

export function RecurrenceEditor({
  task,
  today,
  onSave,
}: {
  task: Pick<Task, "id" | "recurrenceJson" | "completedAt" | "dueOn" | "dueTime">;
  today: string;
  onSave: (patch: { recurrence: RecurrenceRule | null; dueOn?: string }) => void;
}) {
  useColorScheme();
  const savedRule = task.recurrenceJson ? parseRule(task.recurrenceJson) : null;
  const source = `${task.id}\0${task.recurrenceJson ?? ""}\0${task.completedAt ?? ""}`;
  const [seen, setSeen] = useState(source);
  const [draft, setDraft] = useState(() => draftFromRule(savedRule));
  if (seen !== source) {
    setSeen(source);
    setDraft(draftFromRule(savedRule));
  }

  const locked = task.completedAt !== null;
  const error = recurrenceDraftError(draft);

  function save(next: RecurrenceDraft) {
    if (locked) return;
    if (recurrenceDraftError(next)) return;
    const now = new Date();
    onSave(recurrenceSave(next, { dueOn: task.dueOn, dueTime: task.dueTime }, today, now.getHours() * 60 + now.getMinutes()));
  }

  function update(next: RecurrenceDraft) {
    if (locked) return;
    setDraft(next);
    if (next.freq === "none" && task.recurrenceJson !== null) save(next);
  }

  return (
    <View style={{ gap: 12 }}>
      <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15 }}>
        {savedRule ? describeRule(savedRule) : "Does not repeat."}
      </Text>
      <Choice
        label="Repeat"
        value={draft.freq}
        disabled={locked}
        options={[
          { value: "none", label: "None" },
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
          { value: "yearly", label: "Yearly" },
        ]}
        onChange={(freq) => update({ ...draft, freq: freq as RecurrenceDraft["freq"] })}
      />
      {draft.freq === "none" ? null : (
        <>
          <Field label="Interval" value={draft.interval} keyboardType="decimal-pad" onChangeText={(interval) => update({ ...draft, interval })} />
          {draft.freq === "weekly" ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Weekdays</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {WEEKDAYS.map((day) => {
                  const on = draft.weekdays.includes(day.code);
                  return (
                    <Pressable
                      key={day.code}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on, disabled: locked }}
                      disabled={locked}
                      onPress={() => update({ ...draft, weekdays: toggleWeekday(draft.weekdays, day.code) })}
                      style={{
                        backgroundColor: on ? primary : colors.grouped,
                        borderRadius: 12,
                        borderCurve: "continuous",
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        opacity: locked ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ color: on ? ink : colors.label }}>{day.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {draft.freq === "monthly" || draft.freq === "yearly" ? (
            <Field
              label="Month day"
              value={draft.monthDay}
              placeholder="Day of the due date"
              keyboardType="decimal-pad"
              onChangeText={(monthDay) => update({ ...draft, monthDay })}
            />
          ) : null}
          <Choice
            label="Basis"
            value={draft.basis}
            disabled={locked}
            options={[
              { value: "scheduled", label: "On the scheduled date" },
              { value: "completed", label: "From the day it is completed" },
            ]}
            onChange={(basis) => update({ ...draft, basis: basis as RecurrenceDraft["basis"] })}
          />
          <Choice
            label="Ends"
            value={draft.end}
            disabled={locked}
            options={[
              { value: "never", label: "Never" },
              { value: "on", label: "On a date" },
              { value: "count", label: "After a count" },
            ]}
            onChange={(end) => update({ ...draft, end: end as RecurrenceDraft["end"] })}
          />
          {draft.end === "on" ? (
            <Field label="End date" value={draft.endDate} placeholder="YYYY-MM-DD" autoCapitalize="none" onChangeText={(endDate) => update({ ...draft, endDate })} />
          ) : null}
          {draft.end === "count" ? (
            <Field label="Count" value={draft.endCount} keyboardType="decimal-pad" onChangeText={(endCount) => update({ ...draft, endCount })} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={locked || error !== null}
            onPress={() => save(draft)}
            style={{
              backgroundColor: primary,
              borderRadius: 14,
              borderCurve: "continuous",
              paddingVertical: 14,
              alignItems: "center",
              opacity: locked || error !== null ? 0.6 : 1,
            }}
          >
            <Text style={{ color: ink, fontSize: 17, fontWeight: "600" }}>Save repeat</Text>
          </Pressable>
        </>
      )}
      {error ? <Text style={{ color: ink }}>{error}</Text> : null}
    </View>
  );
}

function toggleWeekday(days: WeekdayCode[], code: WeekdayCode): WeekdayCode[] {
  const next = days.includes(code) ? days.filter((day) => day !== code) : [...days, code];
  return WEEKDAYS.map((day) => day.code).filter((day) => next.includes(day));
}
