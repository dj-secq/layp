import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import {
  addChecklistReminder,
  checklistRemindersForTask,
  removeChecklistReminder,
  type ChecklistReminder,
} from "../db/checklistReminders";
import { checklistLines, toggleChecklistLine } from "../lib/checklist";
import { parseClock } from "../lib/clock";
import { reminderLabel } from "../lib/remind";
import { useApp } from "../state/AppState";

export function ChecklistRows({
  taskId,
  notes,
  onNotes,
}: {
  taskId: string;
  notes: string;
  onNotes: (notes: string) => void;
}) {
  const app = useApp();
  const [reminders, setReminders] = useState<ChecklistReminder[]>([]);
  const [openText, setOpenText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lines = checklistLines(notes);

  useEffect(() => {
    let cancel = false;
    checklistRemindersForTask(taskId)
      .then((rows) => {
        if (!cancel) setReminders(rows);
      })
      .catch(() => {
        if (!cancel) setError("Not saved");
      });
    return () => {
      cancel = true;
    };
  }, [taskId, app.revision]);

  if (lines.length === 0) return null;

  return (
    <div className="grid gap-2">
      <ul className="grid gap-1">
        {lines.map((line) => {
          const reminder = reminders.find((row) => row.lineText === line.text);
          const open = openText === line.text;
          return (
            <li key={line.index} className="grid gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => onNotes(toggleChecklistLine(notes, line.index))}
                >
                  <span className="check press-sm" aria-hidden>
                    {line.done ? "x" : ""}
                  </span>
                  <span className={line.done ? "text-ink-soft line-through" : undefined}>{line.text || "Checklist item"}</span>
                </button>
                <Button
                  small
                  aria-expanded={open}
                  aria-label={reminder ? `Reminder for ${line.text || "checklist item"}` : `Add a reminder for ${line.text || "checklist item"}`}
                  onClick={() => setOpenText(open ? null : line.text)}
                >
                  <Bell size={14} strokeWidth={1.75} aria-hidden />
                  {reminder ? reminderLabel(reminder.minutesBefore) : "Remind"}
                </Button>
              </div>
              {open ? (
                <ReminderForm
                  taskId={taskId}
                  notes={notes}
                  lineText={line.text}
                  reminder={reminder ?? null}
                  clock={app.settings.clock}
                  onError={setError}
                  onDone={() => {
                    setOpenText(null);
                    app.bump();
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <p className="meta text-danger">{error}</p> : null}
    </div>
  );
}

function ReminderForm({
  taskId,
  notes,
  lineText,
  reminder,
  clock,
  onError,
  onDone,
}: {
  taskId: string;
  notes: string;
  lineText: string;
  reminder: ChecklistReminder | null;
  clock: "12" | "24";
  onError: (message: string | null) => void;
  onDone: () => void;
}) {
  const dueRef = useRef<HTMLInputElement>(null);
  const [timeText, setTimeText] = useState(reminder?.dueTime ? formatTime(reminder.dueTime, clock) : "");
  const [minutes, setMinutes] = useState(reminder ? String(reminder.minutesBefore) : "0");

  async function save() {
    const picked = dueRef.current?.value ?? "";
    const trimmed = timeText.trim();
    const dueTime = trimmed ? parseClock(trimmed) : null;
    if (trimmed && !dueTime) {
      onError(clock === "12" ? "Use a time like 6:00 PM." : "Use a time like 18:00.");
      return;
    }
    const parsed = Number(minutes);
    const result = await addChecklistReminder({
      taskId,
      notes,
      lineText,
      dueOn: picked,
      dueTime,
      minutesBefore: parsed,
    });
    if (result.status !== "saved") {
      onError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    onError(null);
    onDone();
  }

  return (
    <div className="grid gap-2">
      <label className="grid gap-1">
        <span className="label">Date</span>
        <input
          ref={dueRef}
          className="field"
          type="date"
          aria-label="Date"
          defaultValue={reminder?.dueOn ?? ""}
        />
      </label>
      <Field
        label="Time"
        value={timeText}
        placeholder={clock === "12" ? "6:00 PM" : "18:00"}
        onChange={(event) => setTimeText(event.target.value)}
      />
      <Field label="Minutes before" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
      <p className="meta">Leave the time empty to use 9:00 AM.</p>
      <div className="flex gap-2">
        <Button small onClick={() => void save()}>
          Save reminder
        </Button>
        {reminder ? (
          <Button
            small
            variant="danger"
            onClick={() => {
              void removeChecklistReminder(reminder.id).then((result) => {
                if (result.status === "saved") {
                  onError(null);
                  onDone();
                } else onError("Not saved");
              });
            }}
          >
            Remove reminder
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function formatTime(hhmm: string, clock: "12" | "24"): string {
  const [hourText, minute] = hhmm.split(":");
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || !minute) return hhmm;
  if (clock === "24") return `${String(hour).padStart(2, "0")}:${minute}`;
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 || 12;
  return `${twelve}:${minute} ${suffix}`;
}
