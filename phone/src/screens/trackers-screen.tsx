import { Choice } from "@/components/choice";
import { Field } from "@/components/field";
import { PrimaryButton } from "@/components/primary-button";
import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import {
  archiveTracker,
  clearLog,
  createTracker,
  loadTrackers,
  logsBetween,
  logsForTracker,
  monthBounds,
  restoreTracker,
  trackerLogCounts,
  updateTracker,
  upsertLog,
  type Tracker,
  type TrackerLog,
} from "@/db/journal";
import { usePhone } from "@/state/phone";
import { colors, ink, primary } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { DEFAULT_LIST_COLOR, STICKERS, monthCells, monthLabel, shiftMonth, streak, todayIso, type Schedule, type TrackerKind } from "@layp/shared";
import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

const KINDS: { value: TrackerKind; label: string }[] = [
  { value: "check", label: "Check" },
  { value: "count", label: "Count" },
  { value: "number", label: "Number" },
  { value: "scale", label: "Scale" },
  { value: "minutes", label: "Minutes" },
];

export function TrackersScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const today = todayIso();
  const [cursor, setCursor] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  const [logs, setLogs] = useState<TrackerLog[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [streaks, setStreaks] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Tracker | null>(null);
  const [adding, setAdding] = useState(false);
  const [cell, setCell] = useState<{ tracker: Tracker; day: string } | null>(null);
  const bounds = monthBounds(cursor.year, cursor.month);
  const days = monthCells(cursor.year, cursor.month, settings.weekStart).filter((iso): iso is string => iso !== null);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void Promise.all([loadTrackers(true), logsBetween(bounds.from, bounds.to), trackerLogCounts()]).then(
      async ([rows, nextLogs, nextCounts]) => {
        if (cancel) return;
        const active = rows.filter((tracker) => !tracker.isHobby && !tracker.archivedAt);
        const pairs = await Promise.all(active.map(async (tracker) => [tracker.id, await logsForTracker(tracker.id)] as const));
        if (cancel) return;
        setTrackers(rows);
        setLogs(nextLogs);
        setCounts(nextCounts);
        setStreaks(
          new Map(
            pairs.map(([id, history]) => {
              const tracker = active.find((item) => item.id === id);
              if (!tracker) return [id, ""] as const;
              const result = streak({
                kind: tracker.kind,
                dailyTarget: tracker.dailyTarget,
                schedule: tracker.schedule,
                logs: history,
                today,
                weekStart: settings.weekStart,
              });
              return [id, result.label] as const;
            }),
          ),
        );
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load trackers.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, bounds.from, bounds.to, retry, today, settings.weekStart]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && trackers === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  const active = (trackers ?? []).filter((tracker) => !tracker.isHobby && !tracker.archivedAt);
  const archived = (trackers ?? []).filter((tracker) => !tracker.isHobby && tracker.archivedAt);

  async function cycle(tracker: Tracker, day: string) {
    const log = logs.find((item) => item.trackerId === tracker.id && item.day === day);
    if (log?.state === "done") {
      const result = await upsertLog(tracker, day, { state: "skipped", valueText: "", note: log.note });
      if (result.status !== "saved") setError(result.status === "error" ? result.message : "Not saved");
      else phone.changed();
      return;
    }
    if (log?.state === "skipped") {
      const result = await clearLog(tracker.id, day);
      if (result.status !== "saved") setError(result.status === "error" ? result.message : "Not saved");
      else phone.changed();
      return;
    }
    const result = await upsertLog(tracker, day, { state: "done", valueText: "", note: "" });
    if (result.status !== "saved") setError(result.status === "error" ? result.message : "Not saved");
    else phone.changed();
  }

  return (
    <ScreenScroll>
      <Stack.Title>Trackers</Stack.Title>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <TextButton label="Previous" onPress={() => setCursor((current) => shiftMonth(current.year, current.month, -1))} />
        <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{monthLabel(cursor.year, cursor.month)}</Text>
        <TextButton label="Next" onPress={() => setCursor((current) => shiftMonth(current.year, current.month, 1))} />
      </View>
      {trackers === null ? <Text style={{ color: colors.label }}>Loading trackers…</Text> : null}
      {error && trackers !== null ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {trackers !== null && active.length === 0 ? (
        <Text style={{ color: colors.label, fontSize: 17 }}>Add a row. Sleep and workout already live on the day page.</Text>
      ) : null}
      {active.map((tracker) => (
        <View key={tracker.id} style={{ gap: 8 }}>
          <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{tracker.name}</Text>
          <Text style={{ color: colors.secondaryLabel }}>{streaks.get(tracker.id) ?? ""}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
            {days.map((iso) => {
              const log = logs.find((item) => item.trackerId === tracker.id && item.day === iso);
              const filled = log?.state === "done";
              return (
                <Pressable
                  key={iso}
                  accessibilityRole="button"
                  onPress={() => {
                    if (tracker.kind === "check") void cycle(tracker, iso);
                    else setCell({ tracker, day: iso });
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: filled ? tracker.color : colors.grouped,
                    borderWidth: iso === today ? 1.5 : 0,
                    borderColor: ink,
                  }}
                >
                  <Text style={{ color: filled ? ink : colors.label, fontSize: 11 }}>
                    {log?.state === "done" && log.value !== null ? String(log.value) : log?.state === "skipped" ? "–" : Number(iso.slice(-2))}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: "row" }}>
            <TextButton label="Edit" onPress={() => setEditing(tracker)} />
            <TextButton
              label="Archive"
              onPress={() => {
                void archiveTracker(tracker).then((result) => {
                  if (result.status === "saved") phone.changed();
                  else setError(result.status === "error" ? result.message : "Not saved");
                });
              }}
            />
          </View>
        </View>
      ))}
      {cell ? (
        <LogForm
          tracker={cell.tracker}
          day={cell.day}
          log={logs.find((item) => item.trackerId === cell.tracker.id && item.day === cell.day)}
          onClose={() => setCell(null)}
          onError={setError}
        />
      ) : null}
      {adding || editing ? (
        <TrackerForm
          tracker={editing}
          locked={editing ? (counts.get(editing.id) ?? 0) > 0 : false}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onError={setError}
        />
      ) : (
        <TextButton label="Add a row" onPress={() => setAdding(true)} />
      )}
      {archived.length > 0 ? <Text style={{ color: colors.secondaryLabel, fontWeight: "600" }}>Archived</Text> : null}
      {archived.map((tracker) => (
        <View key={tracker.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: colors.label }}>{tracker.name}</Text>
          <TextButton
            label="Restore"
            onPress={() => {
              void restoreTracker(tracker).then((result) => {
                if (result.status === "saved") phone.changed();
                else setError(result.status === "error" ? result.message : "Not saved");
              });
            }}
          />
        </View>
      ))}
    </ScreenScroll>
  );
}

function TrackerForm({
  tracker,
  locked,
  onClose,
  onError,
}: {
  tracker: Tracker | null;
  locked: boolean;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const phone = usePhone();
  const [name, setName] = useState(tracker?.name ?? "");
  const [kind, setKind] = useState<TrackerKind>(tracker?.kind ?? "check");
  const [unit, setUnit] = useState(tracker?.unit ?? "");
  const [target, setTarget] = useState(tracker?.dailyTarget === null || tracker?.dailyTarget === undefined ? "" : String(tracker.dailyTarget));
  const [color, setColor] = useState(tracker?.color ?? DEFAULT_LIST_COLOR);
  const [schedule, setSchedule] = useState<Schedule>(tracker?.schedule ?? { type: "daily" });

  async function save() {
    const input = { name, kind, unit, target, schedule, color };
    const result = tracker ? await updateTracker(tracker, input) : await createTracker(input);
    if (result.status === "saved") {
      phone.changed();
      onClose();
      return;
    }
    onError(result.status === "error" ? result.message : "Not saved");
  }

  return (
    <View style={{ gap: 8 }}>
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
      <Choice label="Kind" value={kind} options={KINDS} disabled={locked} onChange={(value) => setKind(value as TrackerKind)} />
      {locked ? <Text style={{ color: colors.label }}>Kind stays after the first log.</Text> : null}
      <Field label="Unit" value={unit} onChangeText={setUnit} maxLength={20} />
      <Field label="Daily target" value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
      <Choice
        label="Schedule"
        value={schedule.type}
        options={[
          { value: "daily", label: "Daily" },
          { value: "weekdays", label: "Weekdays" },
          { value: "weekly_count", label: "Times a week" },
        ]}
        onChange={(value) => {
          if (value === "weekdays") setSchedule({ type: "weekdays", days: [1, 2, 3, 4, 5] });
          else if (value === "weekly_count") setSchedule({ type: "weekly_count", count: 3 });
          else setSchedule({ type: "daily" });
        }}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {STICKERS.map((sticker) => (
          <Pressable
            key={sticker.hex}
            accessibilityLabel={sticker.name}
            onPress={() => setColor(sticker.hex)}
            style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: sticker.hex, borderWidth: color === sticker.hex ? 2 : 0, borderColor: ink }}
          />
        ))}
      </View>
      <PrimaryButton label={tracker ? "Save" : "Add a row"} onPress={() => void save()} />
      <TextButton label="Cancel" onPress={onClose} />
    </View>
  );
}

function LogForm({
  tracker,
  day,
  log,
  onClose,
  onError,
}: {
  tracker: Tracker;
  day: string;
  log: TrackerLog | undefined;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const phone = usePhone();
  const [value, setValue] = useState(log?.state === "done" && log.value !== null ? String(log.value) : "");
  const [note, setNote] = useState(log?.note ?? "");

  async function save(state: "done" | "skipped") {
    const result = await upsertLog(tracker, day, { state, valueText: state === "skipped" ? "" : value, note });
    if (result.status === "saved") {
      phone.changed();
      onClose();
      return;
    }
    onError(result.status === "error" ? result.message : "Not saved");
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.label, fontWeight: "600" }}>{tracker.name} {day}</Text>
      <Field label={tracker.unit ? `Value (${tracker.unit})` : "Value"} value={value} onChangeText={setValue} keyboardType="decimal-pad" />
      <Field label="Note" value={note} onChangeText={setNote} />
      <PrimaryButton label="Save" onPress={() => void save("done")} />
      <TextButton label="Skip" onPress={() => void save("skipped")} />
      <TextButton
        label="Clear"
        onPress={() => {
          void clearLog(tracker.id, day).then((result) => {
            if (result.status === "saved") {
              phone.changed();
              onClose();
            } else onError(result.status === "error" ? result.message : "Not saved");
          });
        }}
      />
    </View>
  );
}
