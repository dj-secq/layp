import { playChime } from "@/audio/chime";
import { AddressForm } from "@/components/address-form";
import { Choice } from "@/components/choice";
import { Field } from "@/components/field";
import { ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import { exportPhoneDatabase, importPhoneDatabase, pickDatabaseFile } from "@/db/backup";
import { saveSetting, type SettingKey } from "@/db/settings";
import { deleteTag, loadTags, removeTagFromTasks, renameTag, tagUseCount } from "@/db/tags";
import { randomUUID } from "@/link/random";
import { ArchiveList } from "@/screens/archive-screen";
import { TrashList } from "@/screens/trash-screen";
import { usePhone } from "@/state/phone";
import { colors, ink } from "@/theme/colors";
import { papers, themeNames, type ThemeName } from "@/theme/paper";
import { usePaper, usePhoneSettings } from "@/theme/theme";
import { clampPomoMinutes, focusSounds, snippetDraftError, snippetsJson, type FocusSound, type QuickSnippet, type Tag } from "@layp/shared";
import Constants from "expo-constants";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

export function SettingsScreen() {
  usePaper();
  const phone = usePhone();
  const settings = usePhoneSettings();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [work, setWork] = useState(String(settings.pomoWorkMinutes));
  const [rest, setRest] = useState(String(settings.pomoBreakMinutes));
  const [tags, setTags] = useState<Tag[]>([]);
  const [pendingTag, setPendingTag] = useState<Tag | null>(null);
  const [word, setWord] = useState("");

  useEffect(() => setWork(String(settings.pomoWorkMinutes)), [settings.pomoWorkMinutes]);
  useEffect(() => setRest(String(settings.pomoBreakMinutes)), [settings.pomoBreakMinutes]);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void loadTags().then(
      (rows) => {
        if (!cancel) setTags(rows);
      },
      () => undefined,
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision]);

  if (!phone.ready) return null;
  if (!phone.hasKey) return <Redirect href="/" />;

  const status = phone.status;
  const statusText = !status ? "Not synced yet" : status.kind === "ok" ? status.at : status.message;

  async function save(key: SettingKey, value: string) {
    try {
      await saveSetting(key, value);
      setError(null);
      phone.changed();
    } catch {
      setError("Not saved");
    }
  }

  async function saveMinutes(key: "pomoWorkMinutes" | "pomoBreakMinutes", text: string, current: number) {
    const minutes = clampPomoMinutes(Number(text));
    if (key === "pomoWorkMinutes") setWork(String(minutes));
    else setRest(String(minutes));
    if (minutes === current) return;
    await save(key, String(minutes));
  }

  async function chooseSound(key: "pomoSoundWork" | "pomoSoundBreak", sound: FocusSound) {
    await save(key, sound);
    if (sound !== "none") playChime(sound);
  }

  async function removeTag(tag: Tag) {
    const used = await tagUseCount(tag.id);
    if (used > 0) {
      setPendingTag(tag);
      setError(`This tag is on ${used} tasks.`);
      return;
    }
    const result = await deleteTag(tag.id);
    if (result.status === "saved") {
      setError(null);
      phone.changed();
    } else setError(result.message);
  }

  return (
    <ScreenScroll>
      <LaypTitle>Settings</LaypTitle>
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {notice ? <Text style={{ color: colors.label }}>{notice}</Text> : null}

      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Appearance</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {themeNames.map((name) => (
          <ThemeSwatch key={name} name={name} selected={settings.theme === name} onPress={() => void save("theme", name)} />
        ))}
      </View>

      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Calendar</Text>
      <Choice
        label="Week starts"
        value={settings.weekStart}
        options={[
          { value: "monday", label: "Monday" },
          { value: "sunday", label: "Sunday" },
        ]}
        onChange={(value) => void save("weekStart", value)}
      />
      <Choice
        label="Clock"
        value={settings.clock}
        options={[
          { value: "12", label: "12-hour" },
          { value: "24", label: "24-hour" },
        ]}
        onChange={(value) => void save("clock", value)}
      />

      <SnippetSettings
        snippets={settings.quickSnippets}
        onSave={async (next) => {
          await saveSetting("quickSnippets", snippetsJson(next));
          phone.changed();
        }}
        onError={setError}
      />

      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Focus</Text>
      <Field
        label="Work minutes"
        value={work}
        keyboardType="number-pad"
        onChangeText={setWork}
        onBlur={() => void saveMinutes("pomoWorkMinutes", work, settings.pomoWorkMinutes)}
      />
      <Field
        label="Break minutes"
        value={rest}
        keyboardType="number-pad"
        onChangeText={setRest}
        onBlur={() => void saveMinutes("pomoBreakMinutes", rest, settings.pomoBreakMinutes)}
      />
      <Choice
        label="Work sound"
        value={settings.pomoSoundWork}
        options={focusSounds.map((sound) => ({ value: sound, label: sound }))}
        onChange={(value) => void chooseSound("pomoSoundWork", value as FocusSound)}
      />
      <Choice
        label="Break sound"
        value={settings.pomoSoundBreak}
        options={focusSounds.map((sound) => ({ value: sound, label: sound }))}
        onChange={(value) => void chooseSound("pomoSoundBreak", value as FocusSound)}
      />

      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Phone</Text>
      <Text selectable style={{ color: status?.kind === "down" ? ink : colors.secondaryLabel, fontSize: 16 }}>
        {statusText}
      </Text>
      <AddressForm onDone={() => undefined} />
      <Pressable
        accessibilityRole="button"
        onPress={() => void phone.forget()}
        style={{ borderRadius: 14, borderCurve: "continuous", paddingVertical: 14, alignItems: "center", backgroundColor: colors.grouped, minHeight: 48 }}
      >
        <Text style={{ color: colors.label, fontSize: 17 }}>Forget this phone</Text>
      </Pressable>

      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Tags</Text>
      {tags.length === 0 ? <Text style={{ color: colors.label, fontSize: 16 }}>No tags yet.</Text> : null}
      {tags.map((tag) => (
        <TagRow
          key={tag.id}
          tag={tag}
          onRename={async (next) => {
            const result = await renameTag(tag, next);
            if (result.status === "saved") phone.changed();
            else setError(result.message);
          }}
          onDelete={() => void removeTag(tag)}
        />
      ))}
      {pendingTag ? (
        <TextButton
          label="Remove from tasks"
          onPress={() => {
            void removeTagFromTasks(pendingTag.id).then((result) => {
              setPendingTag(null);
              if (result.status === "saved") {
                setError(null);
                phone.changed();
              } else setError("Not saved");
            });
          }}
        />
      ) : null}

      <ArchiveList />
      <TrashList />

      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Data</Text>
      <Text style={{ color: colors.label, fontSize: 16 }}>This phone keeps its own copy.</Text>
      <TextButton label="Export" onPress={() => void exportPhoneDatabase().then((message) => setNotice(message))} />
      <Field label="Type LAYP to import" value={word} autoCapitalize="characters" onChangeText={setWord} />
      <TextButton
        label="Import"
        disabled={word !== "LAYP"}
        onPress={() => {
          void (async () => {
            const uri = await pickDatabaseFile();
            if (!uri) return;
            const message = await importPhoneDatabase(uri);
            if (message) setNotice(message);
            else {
              setWord("");
              setNotice("Imported.");
              phone.changed();
            }
          })();
        }}
      />

      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>About</Text>
      <Text selectable style={{ color: colors.label, fontSize: 16 }}>Layp {Constants.expoConfig?.version ?? "0.2.0"}</Text>
      <Text style={{ color: colors.label, fontSize: 16 }}>
        The day sits next to the tasks. Sleep, a workout, a mood, and a diary line stay with what is due. Trackers are the checks and counts. Hobbies are minutes you spent, not a streak you owe.
      </Text>
      <Text style={{ color: colors.label, fontSize: 16 }}>
        This phone keeps its own copy and syncs with the computer on the same Wi-Fi. MIT License.
      </Text>
    </ScreenScroll>
  );
}

function ThemeSwatch({ name, selected, onPress }: { name: ThemeName; selected: boolean; onPress: () => void }) {
  const face = papers[name];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ width: 76, gap: 6, alignItems: "center" }}
    >
      <View
        style={{
          borderWidth: 2,
          borderColor: selected ? colors.label : "transparent",
          borderRadius: 12,
          borderCurve: "continuous",
          padding: 2,
        }}
      >
        <View
          style={{
            width: 76,
            height: 48,
            borderRadius: 8,
            borderCurve: "continuous",
            backgroundColor: face.background,
            borderWidth: 1,
            borderColor: face.border,
            padding: 6,
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              height: 16,
              borderRadius: 4,
              borderCurve: "continuous",
              backgroundColor: face.grouped,
              borderWidth: 1,
              borderColor: face.border,
            }}
          />
        </View>
      </View>
      <Text style={{ color: colors.label, fontSize: 13 }}>{face.title}</Text>
    </Pressable>
  );
}

function TagRow({ tag, onRename, onDelete }: { tag: Tag; onRename: (name: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(tag.name);
  useEffect(() => setName(tag.name), [tag.name]);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: tag.color }} />
        <View style={{ flex: 1 }}>
          <Field
            label="Name"
            value={name}
            maxLength={80}
            onChangeText={setName}
            onBlur={() => {
              if (name.trim() === tag.name) return;
              onRename(name);
            }}
          />
        </View>
      </View>
      <TextButton label="Delete tag" onPress={onDelete} />
    </View>
  );
}

function SnippetSettings({
  snippets,
  onSave,
  onError,
}: {
  snippets: QuickSnippet[];
  onSave: (next: QuickSnippet[]) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [line, setLine] = useState("");

  async function add() {
    const message = snippetDraftError(snippets, name, line);
    if (message) {
      onError(message);
      return;
    }
    try {
      await onSave([...snippets, { id: randomUUID(), name: name.trim(), line: line.trim() }]);
      setName("");
      setLine("");
      onError(null);
    } catch {
      onError("Not saved");
    }
  }

  async function change(snippet: QuickSnippet, nextName: string, nextLine: string) {
    const message = snippetDraftError(snippets, nextName, nextLine, snippet.id);
    if (message) {
      onError(message);
      return;
    }
    if (nextName.trim() === snippet.name && nextLine.trim() === snippet.line) return;
    try {
      await onSave(snippets.map((item) => (item.id === snippet.id ? { ...item, name: nextName.trim(), line: nextLine.trim() } : item)));
      onError(null);
    } catch {
      onError("Not saved");
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.label, fontSize: 22, fontWeight: "600" }}>Quick add</Text>
      <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>A short name fills its line. Type the name, or /name, in quick add.</Text>
      <Field label="Name" value={name} maxLength={24} autoCapitalize="none" onChangeText={setName} />
      <Field label="Line" value={line} maxLength={200} autoCapitalize="none" onChangeText={setLine} />
      <TextButton label="Add snippet" onPress={() => void add()} />
      {snippets.map((snippet) => (
        <SnippetRow
          key={snippet.id}
          snippet={snippet}
          onChange={change}
          onDelete={() => void onSave(snippets.filter((item) => item.id !== snippet.id)).catch(() => onError("Not saved"))}
        />
      ))}
    </View>
  );
}

function SnippetRow({
  snippet,
  onChange,
  onDelete,
}: {
  snippet: QuickSnippet;
  onChange: (snippet: QuickSnippet, name: string, line: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(snippet.name);
  const [line, setLine] = useState(snippet.line);
  useEffect(() => setName(snippet.name), [snippet.name]);
  useEffect(() => setLine(snippet.line), [snippet.line]);
  return (
    <View style={{ gap: 8 }}>
      <Field label="Name" value={name} maxLength={24} autoCapitalize="none" onChangeText={setName} onBlur={() => onChange(snippet, name, line)} />
      <Field label="Line" value={line} maxLength={200} autoCapitalize="none" onChangeText={setLine} onBlur={() => onChange(snippet, name, line)} />
      <TextButton label="Delete snippet" onPress={onDelete} />
    </View>
  );
}
