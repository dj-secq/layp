import { useEffect, useState } from "react";
import { Button } from "./Button";
import { clearLog, loadTrackers, logsBetween, upsertLog, type Tracker, type TrackerLog } from "../db/trackers";
import { cellScheduled } from "../lib/journal";
import { useApp } from "../state/AppState";

export function DayTrackers({ date }: { date: string }) {
  const app = useApp();
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [logs, setLogs] = useState<TrackerLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    Promise.all([loadTrackers(false), logsBetween(date, date)])
      .then(([nextTrackers, nextLogs]) => {
        if (cancel) return;
        setTrackers(nextTrackers.filter((tracker) => cellScheduled(tracker.schedule, date)));
        setLogs(nextLogs);
        setError(null);
      })
      .catch(() => {
        if (!cancel) setError("Not saved");
      });
    return () => {
      cancel = true;
    };
  }, [date, app.revision]);

  if (error && trackers.length === 0) return <p className="meta text-danger">{error}</p>;
  if (trackers.length === 0) return null;

  return (
    <div className="grid gap-3">
      {trackers.map((tracker) => (
        <TrackerRow
          key={tracker.id}
          tracker={tracker}
          date={date}
          log={logs.find((item) => item.trackerId === tracker.id)}
        />
      ))}
    </div>
  );
}

function TrackerRow({ tracker, date, log }: { tracker: Tracker; date: string; log: TrackerLog | undefined }) {
  const app = useApp();
  const [value, setValue] = useState(log?.state === "done" && log.value !== null ? String(log.value) : "");
  const [note, setNote] = useState(log?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(log?.state === "done" && log.value !== null ? String(log.value) : "");
    setNote(log?.note ?? "");
  }, [log?.updatedAt, log?.state, log?.value, log?.note]);

  async function save(state: "done" | "skipped", valueText: string, noteText: string) {
    const result = await upsertLog(tracker, date, { state, valueText, note: noteText });
    if (result.status === "saved") {
      setError(null);
      app.bump();
      return;
    }
    setError(result.status === "error" ? result.message : "Not saved");
  }

  async function clear() {
    const result = await clearLog(tracker.id, date);
    if (result.status === "saved") {
      setError(null);
      setValue("");
      setNote("");
      app.bump();
      return;
    }
    setError("Not saved");
  }

  if (tracker.kind === "check") {
    return (
      <div className="grid gap-1">
        <span className="meta">{tracker.name}</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label={tracker.name}>
          <Button variant={log?.state === "done" ? "primary" : "secondary"} aria-pressed={log?.state === "done"} onClick={() => void save("done", "", note)}>
            Done
          </Button>
          <Button variant={log?.state === "skipped" ? "primary" : "secondary"} aria-pressed={log?.state === "skipped"} onClick={() => void save("skipped", "", note)}>
            Skip
          </Button>
          <Button variant="secondary" onClick={() => void clear()}>
            Clear
          </Button>
        </div>
        {error ? <RowError message={error} onRetry={() => void save("done", "", note)} /> : null}
      </div>
    );
  }

  const label = tracker.isHobby ? `${tracker.name} minutes` : tracker.unit ? `${tracker.name} (${tracker.unit})` : tracker.name;

  return (
    <div className="grid gap-2">
      <label className="grid gap-1">
        <span className="meta">{tracker.isHobby ? tracker.name : label}</span>
        <input
          className="field nums"
          aria-label={tracker.isHobby ? `${tracker.name} minutes` : label}
          inputMode={tracker.kind === "number" ? "decimal" : "numeric"}
          value={value}
          placeholder={tracker.isHobby ? "Minutes" : tracker.kind === "scale" ? "1–5" : "Value"}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (tracker.isHobby && value.trim() === "" && note.trim() === "") {
              if (log) void clear();
              return;
            }
            if (value.trim() === "" && note.trim() === "") return;
            const next = tracker.isHobby && value.trim() === "" ? "0" : value;
            if (next === (log?.value === null || log?.value === undefined ? "" : String(log.value)) && note === (log?.note ?? "")) return;
            void save("done", next, note);
          }}
        />
      </label>
      <label className="grid gap-1">
        <span className="meta">Note</span>
        <input
          className="field"
          aria-label={`${tracker.name} note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note === (log?.note ?? "")) return;
            if (tracker.isHobby && value.trim() === "" && note.trim() === "") {
              if (log) void clear();
              return;
            }
            void save("done", value.trim() === "" ? "0" : value, note);
          }}
        />
      </label>
      {tracker.isHobby ? null : (
        <div className="flex flex-wrap gap-2">
          <Button variant={log?.state === "skipped" ? "primary" : "secondary"} aria-pressed={log?.state === "skipped"} onClick={() => void save("skipped", "", note)}>
            Skip
          </Button>
          <Button variant="secondary" onClick={() => void clear()}>
            Clear
          </Button>
        </div>
      )}
      {error ? <RowError message={error} onRetry={() => void save("done", value.trim() === "" ? "0" : value, note)} /> : null}
    </div>
  );
}

function RowError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="meta text-danger">
      {message}{" "}
      <button type="button" className="underline" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}
