import { Field } from "@/components/field";
import { PrimaryButton } from "@/components/primary-button";
import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import {
  archiveTracker,
  createHobby,
  deleteHobby,
  hobbyNotes,
  loadTrackers,
  logsForTracker,
  restoreTracker,
  updateHobby,
  type Tracker,
  type TrackerLog,
} from "@/db/journal";
import { usePhone } from "@/state/phone";
import { colors, ink } from "@/theme/colors";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { DEFAULT_LIST_COLOR, STICKERS, sumMinutes, todayIso, weekBounds, weekBuckets } from "@layp/shared";
import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

export function HobbiesScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const today = todayIso();
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void loadTrackers(true).then(
      (rows) => {
        if (cancel) return;
        setTrackers(rows.filter((row) => row.isHobby));
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load hobbies.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && trackers === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  const active = (trackers ?? []).filter((tracker) => !tracker.archivedAt);
  const archived = (trackers ?? []).filter((tracker) => tracker.archivedAt);
  const week = weekBounds(today, settings.weekStart);

  return (
    <ScreenScroll>
      <Stack.Title>Hobbies</Stack.Title>
      {trackers === null ? <Text style={{ color: colors.label }}>Loading hobbies…</Text> : null}
      {trackers !== null && active.length === 0 ? <Text style={{ color: colors.label, fontSize: 17 }}>Add a hobby</Text> : null}
      {active.map((hobby) => (
        <HobbyCard
          key={hobby.id}
          hobby={hobby}
          from={week.start}
          to={week.end}
          onOpen={() => router.push({ pathname: "/more/hobby/[id]", params: { id: hobby.id } })}
        />
      ))}
      {adding ? (
        <HobbyCreate
          onClose={() => setAdding(false)}
          onError={setError}
        />
      ) : (
        <TextButton label="Add a hobby" onPress={() => setAdding(true)} />
      )}
      {archived.map((hobby) => (
        <View key={hobby.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: colors.label }}>{hobby.name}</Text>
          <TextButton
            label="Restore"
            onPress={() => {
              void restoreTracker(hobby).then((result) => {
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

function HobbyCard({ hobby, from, to, onOpen }: { hobby: Tracker; from: string; to: string; onOpen: () => void }) {
  const phone = usePhone();
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    let cancel = false;
    void logsForTracker(hobby.id).then((logs) => {
      if (!cancel) setMinutes(sumMinutes(logs, from, to));
    });
    return () => {
      cancel = true;
    };
  }, [hobby.id, from, to, phone.revision]);
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 }}>
      <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: hobby.color }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.label, fontSize: 17 }}>{hobby.name}</Text>
        <Text style={{ color: colors.secondaryLabel }}>{minutes} min this week</Text>
      </View>
    </Pressable>
  );
}

function HobbyCreate({ onClose, onError }: { onClose: () => void; onError: (message: string) => void }) {
  const phone = usePhone();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_LIST_COLOR);
  return (
    <View style={{ gap: 8 }}>
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
      <Swatches color={color} onChange={setColor} />
      <PrimaryButton
        label="Add a hobby"
        onPress={() => {
          void createHobby(name, color).then((result) => {
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

export function HobbyDetailScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
  const [hobby, setHobby] = useState<Tracker | null>(null);
  const [missing, setMissing] = useState(false);
  const [logs, setLogs] = useState<TrackerLog[]>([]);
  const [notes, setNotes] = useState<TrackerLog[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_LIST_COLOR);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  useEffect(() => {
    if (!phone.ready || !phone.hasKey || !id) return;
    let cancel = false;
    void Promise.all([loadTrackers(true), logsForTracker(id), hobbyNotes(id, null, 30)]).then(
      ([rows, nextLogs, nextNotes]) => {
        if (cancel) return;
        const found = rows.find((row) => row.id === id && row.isHobby) ?? null;
        setHobby(found);
        setMissing(found === null);
        if (found) {
          setName(found.name);
          setColor(found.color);
        }
        setLogs(nextLogs);
        setNotes(nextNotes);
      },
      () => {
        if (!cancel) setError("Could not load the hobby.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, id]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (missing) return <Centered text="That hobby is not here." />;

  const buckets = weekBuckets(today, settings.weekStart, 12);
  const max = Math.max(1, ...buckets.map((bucket) => sumMinutes(logs, bucket.start, bucket.end)));

  return (
    <ScreenScroll>
      <Stack.Title>{hobby?.name ?? "Hobby"}</Stack.Title>
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
      <Swatches color={color} onChange={setColor} />
      <PrimaryButton
        label="Save"
        onPress={() => {
          if (!hobby) return;
          void updateHobby(hobby, name, color).then((result) => {
            if (result.status === "saved") phone.changed();
            else setError(result.status === "error" ? result.message : "Not saved");
          });
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 80 }}>
        {buckets.map((bucket) => {
          const minutes = sumMinutes(logs, bucket.start, bucket.end);
          return (
            <View key={bucket.start} style={{ flex: 1, height: `${Math.max(8, (minutes / max) * 100)}%`, backgroundColor: color, borderRadius: 4 }} />
          );
        })}
      </View>
      {notes.map((note) => (
        <Text key={note.id} style={{ color: colors.label }}>{note.day}: {note.note}</Text>
      ))}
      <TextButton
        label="Archive"
        onPress={() => {
          if (!hobby) return;
          void archiveTracker(hobby).then((result) => {
            if (result.status === "saved") {
              phone.changed();
              router.back();
            } else setError(result.status === "error" ? result.message : "Not saved");
          });
        }}
      />
      <Field label="Type the name to delete" value={typed} onChangeText={setTyped} />
      <TextButton
        label="Delete"
        onPress={() => {
          if (!hobby) return;
          void deleteHobby(hobby, typed).then((result) => {
            if (result.status === "saved") {
              phone.changed();
              router.back();
            } else setError(result.status === "error" ? result.message : "Not saved");
          });
        }}
      />
    </ScreenScroll>
  );
}

function Swatches({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  usePaper();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {STICKERS.map((sticker) => (
        <Pressable
          key={sticker.hex}
          accessibilityLabel={sticker.name}
          onPress={() => onChange(sticker.hex)}
          style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: sticker.hex, borderWidth: color === sticker.hex ? 2 : 0, borderColor: ink }}
        />
      ))}
    </View>
  );
}
