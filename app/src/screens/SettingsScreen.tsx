import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Choice } from "../components/Choice";
import { Dialog } from "../components/Dialog";
import { useShortcutRegistered } from "../components/DesktopShell";
import { Field } from "../components/Field";
import { closeDatabase, databaseFile, openDatabase, run } from "../db/client";
import { checkBackup, exportBackup, exportZip, failureText, importBackup, showDatabaseFolder, showLogFolder } from "../desktop/backup";
import { loadArchivedLists, purgeList, restoreList } from "../db/lists";
import { deleteTag, loadTags, removeTagFromTasks, renameTag, tagUseCount, type Tag } from "../db/tags";
import { themeNames, type Settings, type TaskList, type ThemeName } from "../db/types";
import { playChime, unlockChime } from "../lib/chime";
import { focusSounds, parseFocusSound, type FocusSound } from "../lib/focusSound";
import { clampPomoMinutes } from "../lib/pomo";
import { useApp } from "../state/AppState";

const themeFaces: Record<ThemeName, { name: string; canvas: string; surface: string; ink: string }> = {
  light: { name: "Light", canvas: "#f4f1ea", surface: "#fffcf8", ink: "#2c2824" },
  dark: { name: "Dark", canvas: "#1c1b19", surface: "#282623", ink: "#f4efe6" },
  dusk: { name: "Dusk", canvas: "#2a2420", surface: "#362e28", ink: "#f6efe4" },
  ink: { name: "Ink", canvas: "#1a2128", surface: "#24303a", ink: "#e7eef4" },
  sage: { name: "Sage", canvas: "#e7efe6", surface: "#f7fbf6", ink: "#243028" },
  sea: { name: "Sea", canvas: "#e5eef2", surface: "#f5fafc", ink: "#1d2c36" },
  bloom: { name: "Bloom", canvas: "#f8eee9", surface: "#fff8f5", ink: "#3a2a28" },
  slate: { name: "Slate", canvas: "#e8eaee", surface: "#f7f8fa", ink: "#24282e" },
};

function ThemeSwatch({ id, current, onChoose }: { id: ThemeName; current: boolean; onChoose: () => void }) {
  const face = themeFaces[id];
  return (
    <button type="button" className="theme-swatch" aria-pressed={current} onClick={onChoose}>
      <span className="theme-face" style={{ background: face.canvas }} aria-hidden>
        <span style={{ background: face.surface }} />
      </span>
      {face.name}
    </button>
  );
}

export function SettingsScreen() {
  const app = useApp();
  const [path, setPath] = useState(app.dbPath);
  const [exists, setExists] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    databaseFile()
      .then((file) => {
        if (cancel) return;
        setPath(file.path);
        setExists(file.exists);
      })
      .catch(() => {
        if (!cancel) setError("The database path could not be read.");
      });
    return () => {
      cancel = true;
    };
  }, [app.revision]);

  async function choose<K extends keyof Settings>(key: K, value: Settings[K]) {
    setError(null);
    try {
      await app.updateSettings({ [key]: value });
    } catch {
      setError("Not saved");
    }
  }

  return (
    <>
      <h1 className="page-title screen-head">Settings</h1>
      <div className="grid max-w-3xl gap-5">
      {error ? <p className="meta text-danger">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      <section className="settings-group">
        <h2 className="page-title">Appearance</h2>
        <div className="flex flex-wrap gap-4" role="group" aria-label="Theme">
          {themeNames.map((id) => (
            <ThemeSwatch key={id} id={id} current={app.settings.theme === id} onChoose={() => void choose("theme", id)} />
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h2 className="page-title">Calendar</h2>
        <p className="label">Week starts</p>
        <div className="flex gap-2">
          <Button variant={app.settings.weekStart === "monday" ? "primary" : "secondary"} aria-pressed={app.settings.weekStart === "monday"} onClick={() => void choose("weekStart", "monday")}>
            Monday
          </Button>
          <Button variant={app.settings.weekStart === "sunday" ? "primary" : "secondary"} aria-pressed={app.settings.weekStart === "sunday"} onClick={() => void choose("weekStart", "sunday")}>
            Sunday
          </Button>
        </div>
        <p className="label">Clock</p>
        <div className="flex gap-2">
          <Button variant={app.settings.clock === "12" ? "primary" : "secondary"} aria-pressed={app.settings.clock === "12"} onClick={() => void choose("clock", "12")}>
            12-hour
          </Button>
          <Button variant={app.settings.clock === "24" ? "primary" : "secondary"} aria-pressed={app.settings.clock === "24"} onClick={() => void choose("clock", "24")}>
            24-hour
          </Button>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="page-title">Desktop</h2>
        {app.notificationPermission === "denied" ? (
          <p>Desktop notifications are off. Due reminders stay in the Reminders list on Today.</p>
        ) : app.notificationPermission === "granted" ? (
          <p>Desktop notifications are on.</p>
        ) : (
          <p>Layp asks to notify you the first time a task has a reminder.</p>
        )}
        <p className="label">Close button</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={app.settings.closeBehavior === "quit" ? "primary" : "secondary"}
            aria-pressed={app.settings.closeBehavior === "quit"}
            onClick={() => void choose("closeBehavior", "quit")}
          >
            Quit when closed
          </Button>
          <Button
            variant={app.settings.closeBehavior === "tray" ? "primary" : "secondary"}
            aria-pressed={app.settings.closeBehavior === "tray"}
            onClick={() => void choose("closeBehavior", "tray")}
          >
            Keep running in the tray
          </Button>
        </div>
        <ShortcutField />
      </section>

      <section className="settings-group">
        <h2 className="page-title">Focus</h2>
        <PomoField
          label="Work minutes"
          value={app.settings.pomoWorkMinutes}
          onSave={(minutes) => void choose("pomoWorkMinutes", minutes)}
        />
        <PomoField
          label="Break minutes"
          value={app.settings.pomoBreakMinutes}
          onSave={(minutes) => void choose("pomoBreakMinutes", minutes)}
        />
        <SoundField label="Work sound" value={app.settings.pomoSoundWork} onChange={(sound) => void choose("pomoSoundWork", sound)} />
        <SoundField label="Break sound" value={app.settings.pomoSoundBreak} onChange={(sound) => void choose("pomoSoundBreak", sound)} />
      </section>

      <ArchiveList />
      <TagList />

      <section className="settings-group">
        <h2 className="page-title">Trash</h2>
        <div>
          <Button variant="secondary" onClick={() => app.goTrash()}>
            Open trash
          </Button>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="page-title">Data</h2>
        <p>{exists ? "The database file is here." : "The file appears here after the first save."}</p>
        <input className="field" readOnly value={path} aria-label="Database path" />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(path).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy path"}
          </Button>
          <Button variant="secondary" onClick={() => void showDatabaseFolder().catch((err: unknown) => setError(failureText(err, `Could not open ${path}.`)))}>
            Show in folder
          </Button>
          <Button
            variant="secondary"
            onClick={() => void showLogFolder().catch((err: unknown) => setError(failureText(err, "The log folder could not be opened.")))}
          >
            Show logs
          </Button>
          <BackupButtons
            onError={(message) => {
              setNotice(null);
              setError(message);
            }}
            onNotice={(message) => {
              setError(null);
              setNotice(message);
            }}
          />
        </div>
      </section>
      </div>
    </>
  );
}

function PomoField({ label, value, onSave }: { label: string; value: number; onSave: (minutes: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="grid gap-1">
      <span className="label">{label}</span>
      <input
        className="field"
        inputMode="numeric"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const minutes = clampPomoMinutes(Number(text));
          setText(String(minutes));
          if (minutes !== value) onSave(minutes);
        }}
      />
    </label>
  );
}

const SOUND_LABELS: Record<FocusSound, string> = {
  none: "None",
  soft: "Soft",
  bell: "Bell",
  click: "Click",
};

function SoundField({ label, value, onChange }: { label: string; value: FocusSound; onChange: (sound: FocusSound) => void }) {
  return (
    <Choice
      stack
      label={label}
      value={value}
      options={focusSounds.map((sound) => ({ value: sound, label: SOUND_LABELS[sound] }))}
      onChange={(next) => {
        const sound = parseFocusSound(next);
        onChange(sound);
        if (sound !== "none") {
          unlockChime();
          void playChime(sound);
        }
      }}
    />
  );
}

function ArchiveList() {
  const app = useApp();
  const [rows, setRows] = useState<TaskList[]>([]);
  const [pending, setPending] = useState<TaskList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    loadArchivedLists()
      .then((lists) => {
        if (!cancel) setRows(lists);
      })
      .catch(() => {
        if (!cancel) setError("Not saved");
      });
    return () => {
      cancel = true;
    };
  }, [app.revision]);

  async function restore(list: TaskList) {
    const result = await restoreList(list);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setError(null);
    await app.refreshLists();
    app.bump();
  }

  async function remove(list: TaskList) {
    const result = await purgeList(list);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setPending(null);
    setError(null);
    if (app.route.screen === "list" && app.route.listId === list.id) app.goToday();
    await app.refreshLists();
    app.bump();
  }

  return (
    <section className="settings-group">
      <h2 className="page-title">Archive</h2>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {rows.length === 0 ? <p>No archived lists.</p> : null}
      {rows.map((list) => (
        <div key={list.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate">{list.name}</span>
          <div className="flex gap-2">
            <Button small onClick={() => void restore(list)}>
              Restore
            </Button>
            <Button small variant="danger" onClick={() => setPending(list)}>
              Delete list
            </Button>
          </div>
        </div>
      ))}
      {pending ? (
        <Dialog title="Delete list?" onClose={() => setPending(null)}>
          <p>This permanently deletes {pending.name} and every task on it.</p>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" onClick={() => void remove(pending)}>
              Delete list
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

function TagList() {
  const app = useApp();
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Tag | null>(null);
  useEffect(() => {
    let cancel = false;
    loadTags()
      .then((rows) => {
        if (!cancel) setTags(rows);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [app.revision]);

  async function remove(tag: Tag) {
    const used = await tagUseCount(tag.id);
    if (used > 0) {
      setPending(tag);
      setError(`This tag is on ${used} tasks.`);
      return;
    }
    const result = await deleteTag(tag.id);
    if (result.status === "saved") app.bump();
    else setError(result.status === "error" ? result.message : "Not saved");
  }

  return (
    <section className="settings-group">
      <h2 className="page-title">Tags</h2>
      {tags.length === 0 ? <p>No tags yet.</p> : null}
      {error ? <p className="meta text-danger">{error}</p> : null}
      {tags.map((tag) => (
        <div key={tag.id} className="flex flex-wrap items-center gap-2">
          <span className="inline-block h-4 w-4 rounded-[4px] border border-[color:var(--border)]" style={{ background: tag.color }} />
          <input
            className="field"
            defaultValue={tag.name}
            aria-label={`Rename ${tag.name}`}
            onBlur={(event) => {
              if (event.target.value.trim() === tag.name) return;
              void renameTag(tag, event.target.value).then((result) => {
                if (result.status === "saved") app.bump();
                else setError(result.status === "error" ? result.message : "Not saved");
              });
            }}
          />
          <Button small variant="danger" onClick={() => void remove(tag)}>
            Delete tag
          </Button>
        </div>
      ))}
      {pending ? (
        <Button
          variant="danger"
          onClick={() => {
            void removeTagFromTasks(pending.id).then((result) => {
              setPending(null);
              if (result.status === "saved") {
                setError(null);
                app.bump();
              } else setError("Not saved");
            });
          }}
        >
          Remove tag
        </Button>
      ) : null}
    </section>
  );
}

function ShortcutField() {
  const app = useApp();
  const registered = useShortcutRegistered();
  const [text, setText] = useState(app.settings.quickAddShortcut);
  useEffect(() => setText(app.settings.quickAddShortcut), [app.settings.quickAddShortcut]);
  return (
    <label className="grid gap-1">
      <span className="label">Quick add shortcut</span>
      <input
        className="field"
        value={text}
        aria-label="Quick add shortcut"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = text.trim();
          if (!next || next === app.settings.quickAddShortcut) {
            setText(app.settings.quickAddShortcut);
            return;
          }
          void app.updateSettings({ quickAddShortcut: next }).catch(() => setText(app.settings.quickAddShortcut));
        }}
      />
      {registered === false ? <span>Shortcut not registered</span> : null}
    </label>
  );
}

function BackupButtons({ onError, onNotice }: { onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportFolder() {
    const folder = await open({ directory: true, title: "Export backup" });
    if (typeof folder !== "string") return;
    try {
      await run("PRAGMA wal_checkpoint(TRUNCATE)");
      await exportBackup(folder);
      onNotice(`Exported to ${folder}`);
    } catch (err) {
      onError(failureText(err, `Export failed for ${folder}.`));
    }
  }

  async function exportZipFile() {
    const destination = await save({
      title: "Export zip",
      defaultPath: "layp-backup.zip",
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (typeof destination !== "string") return;
    try {
      await run("PRAGMA wal_checkpoint(TRUNCATE)");
      await exportZip(destination);
      onNotice(`Exported to ${destination}`);
    } catch (err) {
      onError(failureText(err, `Export failed for ${destination}.`));
    }
  }

  async function pickImport(directory: boolean) {
    const source = await open({
      directory,
      title: directory ? "Import backup folder" : "Import backup file",
      filters: directory ? undefined : [{ name: "Layp backup", extensions: ["db", "zip"] }],
    });
    if (typeof source !== "string") return;
    try {
      await checkBackup(source);
    } catch (err) {
      onError(failureText(err, `Import failed for ${source}. The current database was left in place.`));
      return;
    }
    setWord("");
    setPicked(source);
  }

  async function confirmImport() {
    if (!picked || busy) return;
    if (word !== "LAYP") {
      onError("Type LAYP to import.");
      return;
    }
    setBusy(true);
    try {
      await run("PRAGMA wal_checkpoint(TRUNCATE)");
      await closeDatabase();
      await importBackup(picked);
      window.location.reload();
    } catch (err) {
      try {
        await openDatabase();
      } catch {
        onError(failureText(err, `Import failed for ${picked}. The current database was left in place.`));
        setBusy(false);
        return;
      }
      onError(failureText(err, `Import failed for ${picked}. The current database was left in place.`));
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => void exportFolder()}>
        Export
      </Button>
      <Button variant="secondary" onClick={() => void exportZipFile()}>
        Export zip
      </Button>
      <Button variant="secondary" onClick={() => void pickImport(true)}>
        Import folder
      </Button>
      <Button variant="secondary" onClick={() => void pickImport(false)}>
        Import file
      </Button>
      {picked ? (
        <Dialog
          title="Import backup"
          onClose={() => {
            if (!busy) setPicked(null);
          }}
        >
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmImport();
            }}
          >
            <p>This replaces the current database with {picked}.</p>
            <Field label="Type LAYP" value={word} onChange={(event) => setWord(event.target.value)} autoComplete="off" />
            <div className="flex gap-2">
              <Button variant="danger" type="submit" disabled={busy}>
                Import backup
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  if (!busy) setPicked(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
