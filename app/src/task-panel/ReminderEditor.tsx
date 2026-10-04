import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { addReminder, remindersForTask, removeReminder, type TaskReminder } from "../db/reminders";
import { reminderLabel } from "../lib/remind";

const PRESETS = [
  { minutes: 0, label: "At due time" },
  { minutes: 5, label: "5 minutes before" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
];

export function ReminderEditor({ taskId, dueOn, onChanged }: { taskId: string; dueOn: string | null; onChanged: () => void }) {
  const [rows, setRows] = useState<TaskReminder[]>([]);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = rows.length >= 10;

  useEffect(() => {
    let cancel = false;
    remindersForTask(taskId)
      .then((next) => {
        if (!cancel) {
          setRows(next);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancel) setError("Not saved");
      });
    return () => {
      cancel = true;
    };
  }, [taskId]);

  async function add(minutes: number) {
    setError(null);
    const result = await addReminder(taskId, minutes);
    if (result.status === "saved") {
      setRows((current) => [...current, result.row].sort((a, b) => a.minutesBefore - b.minutesBefore));
      setCustom("");
      onChanged();
      return;
    }
    setError(result.status === "error" ? result.message : "Not saved");
  }

  async function remove(id: string) {
    setError(null);
    const result = await removeReminder(id);
    if (result.status === "saved") {
      setRows((current) => current.filter((row) => row.id !== id));
      onChanged();
      return;
    }
    setError(result.status === "error" ? result.message : "Not saved");
  }

  function addCustom() {
    if (!custom.trim()) return;
    if (!/^\d+$/.test(custom.trim())) {
      setError("Use 0 to 10080 minutes.");
      return;
    }
    const minutes = Number(custom);
    if (minutes > 10080) {
      setError("Use 0 to 10080 minutes.");
      return;
    }
    void add(minutes);
  }

  return (
    <div className="grid gap-2">
      <span className="label">Reminders</span>
      {dueOn ? null : <p>Add a due date to set a reminder.</p>}
      {rows.length > 0 ? (
        <ul className="grid gap-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2">
              <span>{reminderLabel(row.minutesBefore)}</span>
              <Button small variant="ghost" onClick={() => void remove(row.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {dueOn ? (
        <div className="flex flex-wrap gap-2">
          {PRESETS.filter((preset) => !rows.some((row) => row.minutesBefore === preset.minutes)).map((preset) => (
            <Button key={preset.minutes} small disabled={full} onClick={() => void add(preset.minutes)}>
              {preset.label}
            </Button>
          ))}
        </div>
      ) : null}
      {dueOn ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="label">Minutes before</span>
            <input
              className="field"
              inputMode="numeric"
              value={custom}
              disabled={full}
              aria-label="Minutes before"
              onChange={(event) => setCustom(event.target.value)}
            />
          </label>
          <Button small disabled={full} onClick={addCustom}>
            Add reminder
          </Button>
        </div>
      ) : null}
      {full ? <p className="meta text-danger">A task can have 10 reminders.</p> : null}
      {error ? <p className="meta text-danger">{error}</p> : null}
    </div>
  );
}
