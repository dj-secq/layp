import {
  MOOD_COLORS,
  cleanSleep,
  formatClock,
  formatHours,
  parseClock,
  suggestedSleepHours,
  type ClockPreference,
  type Day,
} from "@layp/shared";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { DIARY_PAUSE_MS, emptyDay, loadDay, saveDay } from "../db/days";
import { loadClock } from "../db/settings";
import { colors, ink, primary } from "../theme/colors";
import { Field } from "./field";

export function DayRecord({ date, onSaved }: { date: string; onSaved: () => void }) {
  useColorScheme();
  const [record, setRecord] = useState<Day | null>(null);
  const [clock, setClock] = useState<ClockPreference>("12");
  const [sleepText, setSleepText] = useState("");
  const [bedText, setBedText] = useState("");
  const [wakeText, setWakeText] = useState("");
  const [sleepError, setSleepError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [diary, setDiary] = useState("");
  const [notSaved, setNotSaved] = useState(false);
  const [conflict, setConflict] = useState<Day | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const draft = useRef<Day | null>(null);
  const chain = useRef(Promise.resolve());
  const hydrated = useRef(false);

  function adopt(next: Day, preference: ClockPreference) {
    draft.current = next;
    setRecord(next);
    setClock(preference);
    setSleepText(next.sleepHours === null ? "" : String(next.sleepHours));
    setBedText(next.sleepBed ? formatClock(next.sleepBed, preference) : "");
    setWakeText(next.sleepWake ? formatClock(next.sleepWake, preference) : "");
    setNote(next.workoutNote);
    setDiary(next.diary);
    setSleepError(null);
    setNotSaved(false);
    setConflict(null);
    setLoadError(null);
  }

  useEffect(() => {
    let cancel = false;
    hydrated.current = false;
    setRecord(null);
    void Promise.all([loadDay(date), loadClock()])
      .then(([row, preference]) => {
        if (cancel) return;
        adopt(row ?? emptyDay(date), preference);
        hydrated.current = true;
      })
      .catch(() => {
        if (cancel) return;
        setLoadError("Could not load this day.");
        hydrated.current = true;
      });
    return () => {
      cancel = true;
    };
  }, [date, retry]);

  function enqueue(force = false) {
    chain.current = chain.current.then(async () => {
      const current = draft.current;
      if (!current) return;
      const result = await saveDay(current, force);
      if (result.status === "saved") {
        const latest = draft.current;
        if (!latest || latest === current) {
          draft.current = result.row;
          setRecord(result.row);
        } else {
          draft.current = { ...latest, updatedAt: result.row.updatedAt };
          setRecord(draft.current);
          enqueue(false);
        }
        setNotSaved(false);
        setConflict(null);
        onSaved();
        return;
      }
      setNotSaved(true);
      if (result.status === "conflict") setConflict(result.current);
    });
  }

  function apply(patch: Partial<Day>, force = false) {
    const current = draft.current;
    if (!current) return;
    const next = { ...current, ...patch };
    draft.current = next;
    setRecord(next);
    enqueue(force);
  }

  function commitTime(text: string, key: "sleepBed" | "sleepWake", setText: (value: string) => void) {
    const parsed = parseClock(text);
    if (text.trim() && parsed === null) {
      const current = draft.current?.[key] ?? null;
      setText(current ? formatClock(current, clock) : "");
      return;
    }
    setText(parsed ? formatClock(parsed, clock) : "");
    if (parsed !== (draft.current?.[key] ?? null)) apply({ [key]: parsed });
  }

  useEffect(() => {
    if (!hydrated.current || draft.current?.day !== date) return;
    if (diary === draft.current.diary) return;
    const handle = setTimeout(() => {
      if (draft.current?.day === date) apply({ diary });
    }, DIARY_PAUSE_MS);
    return () => clearTimeout(handle);
  }, [diary, date]);

  if (loadError) {
    return (
      <View style={{ gap: 12 }}>
        <Text selectable style={{ color: colors.label }}>{loadError}</Text>
        <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}>
          <Text style={{ color: colors.label, fontSize: 17 }}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!record) return <Text style={{ color: colors.label }}>Loading this day…</Text>;

  const suggestion = record.sleepHours === null ? suggestedSleepHours(record.sleepBed, record.sleepWake) : null;

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Day</Text>
        <Text style={{ color: ink, fontSize: 15 }}>{notSaved ? "Not saved" : ""}</Text>
      </View>
      <Field
        label="Sleep hours"
        value={sleepText}
        keyboardType="decimal-pad"
        placeholder="Hours"
        onChangeText={setSleepText}
        onBlur={() => {
          const parsed = cleanSleep(sleepText);
          if ("error" in parsed) {
            setSleepError(parsed.error);
            setNotSaved(true);
            return;
          }
          setSleepError(null);
          setSleepText(parsed.hours === null ? "" : String(parsed.hours));
          if (parsed.hours !== draft.current?.sleepHours) apply({ sleepHours: parsed.hours });
        }}
      />
      {sleepError ? <Text style={{ color: ink }}>{sleepError}</Text> : null}
      <Field
        label="Bed"
        value={bedText}
        placeholder={clock === "12" ? "11:30 PM" : "23:30"}
        autoCapitalize="characters"
        onChangeText={setBedText}
        onBlur={() => commitTime(bedText, "sleepBed", setBedText)}
      />
      <Field
        label="Wake"
        value={wakeText}
        placeholder={clock === "12" ? "7:00 AM" : "07:00"}
        autoCapitalize="characters"
        onChangeText={setWakeText}
        onBlur={() => commitTime(wakeText, "sleepWake", setWakeText)}
      />
      {suggestion !== null ? (
        <View style={{ gap: 8, backgroundColor: colors.grouped, borderRadius: 16, borderCurve: "continuous", padding: 12 }}>
          <Text style={{ color: colors.label }}>Bed to wake is {formatHours(suggestion)} hours.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setSleepText(formatHours(suggestion));
              setSleepError(null);
              apply({ sleepHours: suggestion });
            }}
          >
            <Text style={{ color: ink, fontSize: 17 }}>Use {formatHours(suggestion)}</Text>
          </Pressable>
        </View>
      ) : null}
      <ChoiceLine
        label="Workout"
        value={record.workout ?? ""}
        options={[
          { value: "", label: "Not filled" },
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        onChange={(value) => {
          const workout = value === "" ? null : value === "yes" ? "yes" : "no";
          if (record.workout !== workout) apply({ workout });
        }}
      />
      <Field
        label="Workout note"
        value={note}
        maxLength={500}
        onChangeText={setNote}
        onBlur={() => {
          if (note !== draft.current?.workoutNote) apply({ workoutNote: note });
        }}
      />
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Mood</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {MOOD_COLORS.map((color, index) => {
            const mood = index + 1;
            const selected = record.mood === mood;
            return (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={`Mood ${mood}`}
                accessibilityState={{ selected }}
                onPress={() => apply({ mood: selected ? null : mood })}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selected ? color : colors.grouped,
                }}
              >
                <Text style={{ color: selected ? "#111111" : colors.label, fontSize: 17 }}>{mood}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Field
        label="Diary"
        value={diary}
        multiline
        onChangeText={setDiary}
        onBlur={() => {
          if (draft.current && diary !== draft.current.diary) apply({ diary });
        }}
      />
      {notSaved ? (
        <Pressable accessibilityRole="button" onPress={() => enqueue(false)}>
          <Text style={{ color: colors.label, fontSize: 17 }}>Retry</Text>
        </Pressable>
      ) : null}
      {conflict ? (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.label }}>
            This was saved from a newer edit. Your latest keystrokes are still in the form.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setConflict(null);
              enqueue(true);
            }}
            style={{ backgroundColor: primary, borderRadius: 14, borderCurve: "continuous", paddingVertical: 12, alignItems: "center" }}
          >
            <Text style={{ color: ink, fontSize: 17, fontWeight: "600" }}>Keep mine</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => adopt(conflict, clock)}>
            <Text style={{ color: colors.label, fontSize: 17 }}>Use saved</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ChoiceLine({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  useColorScheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={{
                backgroundColor: selected ? primary : colors.grouped,
                borderRadius: 12,
                borderCurve: "continuous",
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: selected ? ink : colors.label, fontSize: 16 }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
