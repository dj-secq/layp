import { useEffect, useRef, useState } from "react";
import { firstSectionId } from "../db/lists";
import { childCount, completeTask, getTask, patchTask, reopenTask, trashTask, type TaskPatch } from "../db/tasks";
import type { Priority, Task } from "../db/types";
import { describeRule, parseRule } from "../lib/recur";
import { ChecklistRows } from "./ChecklistRows";
import { TaskFiles } from "./TaskFiles";
import { formatClock, parseClock } from "../lib/clock";
import { cleanDuration, cleanTitle } from "../lib/validate";
import { useApp } from "../state/AppState";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "../components/Button";
import { Choice } from "../components/Choice";
import { Dialog } from "../components/Dialog";
import { Area, CheckField, Field } from "../components/Field";
import { ReminderEditor } from "./ReminderEditor";
import { HistoryList, StartFocus, Subtasks, TagPicker } from "./TaskExtras";

export function TaskPanel({ overlay }: { overlay: boolean }) {
  const app = useApp();
  const id = app.openTaskId;
  const [task, setTask] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("");
  const [timeText, setTimeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const [conflict, setConflict] = useState<Task | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [children, setChildren] = useState(0);
  const [estimate, setEstimate] = useState("");
  const [missing, setMissing] = useState(false);
  const draft = useRef<Task | null>(null);
  const chain = useRef(Promise.resolve());

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    setMissing(false);
    getTask(id)
      .then((row) => {
        if (cancel) return;
        if (!row || row.deletedAt) {
          setMissing(true);
          setTask(null);
          return;
        }
        adopt(row);
      })
      .catch(() => {
        if (!cancel) setNotSaved(true);
      });
    return () => {
      cancel = true;
    };
  }, [id]);

  function adopt(row: Task) {
    draft.current = row;
    setTask(row);
    setTitle(row.title);
    setNotes(row.notes);
    setDuration(row.durationMinutes === null ? "" : String(row.durationMinutes));
    setTimeText(row.dueTime ? formatClock(row.dueTime, app.settings.clock) : "");
    setEstimate(row.estimatedPomos === null ? "" : String(row.estimatedPomos));
    setError(null);
    setNotSaved(false);
    setConflict(null);
    setMissing(false);
  }

  function enqueue(patch: TaskPatch, force = false) {
    chain.current = chain.current.then(async () => {
      const current = draft.current;
      if (!current) return;
      const result = await patchTask(current, patch, force);
      if (result.status === "saved") {
        draft.current = result.row;
        setTask(result.row);
        setNotSaved(false);
        setConflict(null);
        setError(null);
        app.bump();
        return;
      }
      setNotSaved(true);
      if (result.status === "error") setError(result.message);
      if (result.status === "conflict") {
        if (result.current?.deletedAt) setMissing(true);
        else if (result.current) setConflict(result.current);
      }
    });
  }

  function saveTitle(nextTitle: string) {
    const cleaned = cleanTitle(nextTitle);
    if ("error" in cleaned) {
      if (draft.current) setTitle(draft.current.title);
      setError(cleaned.error === "Add a title." ? null : cleaned.error);
      return;
    }
    if (cleaned.title !== draft.current?.title) enqueue({ title: cleaned.title });
  }

  function saveNotes(nextNotes: string) {
    if (nextNotes.length > 100_000) {
      setError("Notes can be 100,000 characters.");
      setNotSaved(true);
      return;
    }
    if (nextNotes !== draft.current?.notes) enqueue({ notes: nextNotes });
  }

  useEffect(() => {
    const current = draft.current;
    if (!current || !id || current.id !== id || title.trim() === current.title) return;
    const handle = window.setTimeout(() => {
      if (draft.current?.id === id) saveTitle(title);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [title, id]);

  useEffect(() => {
    const current = draft.current;
    if (!current || !id || current.id !== id || notes === current.notes) return;
    const handle = window.setTimeout(() => {
      if (draft.current?.id === id) saveNotes(notes);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [notes, id]);

  if (!id) return null;

  return (
    <aside className="task-panel" data-overlay={overlay} aria-label="Task">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="page-title">Task</h2>
        <Button variant="ghost" onClick={() => app.setOpenTaskId(null)}>
          Close
        </Button>
      </div>
      {missing ? (
        <p>This task is in the trash.</p>
      ) : !task ? (
        <p>Opening the task…</p>
      ) : (
        <div className="task-form">
          <p role="status" className="meta text-danger">
            {notSaved ? "Not saved" : ""}
          </p>
          <div className="task-actions">
            <Button
              variant="primary"
              onClick={() => {
                void (task.completedAt ? reopenTask(task.id) : completeTask(task.id)).then((result) => {
                  if (result.status === "saved") {
                    adopt(result.row);
                    app.bump();
                  } else setNotSaved(true);
                });
              }}
            >
              {task.completedAt ? <RotateCcw size={16} strokeWidth={1.75} aria-hidden /> : <Check size={16} strokeWidth={1.75} aria-hidden />}
              {task.completedAt ? "Reopen" : "Complete"}
            </Button>
            <StartFocus taskId={task.id} completed={Boolean(task.completedAt)} />
            <Button
              variant="danger"
              onClick={() => {
                setConfirmTrash(true);
                void childCount(task.id).then(setChildren).catch(() => setChildren(0));
              }}
            >
              <Trash2 size={16} strokeWidth={1.75} aria-hidden />
              Move to trash
            </Button>
          </div>
          <Field
            label="Title"
            value={title}
            maxLength={500}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => saveTitle(title)}
          />
          <Choice
            stack
            label="List"
            value={task.listId}
            options={app.lists.map((list) => ({ value: list.id, label: list.name }))}
            onChange={(listId) => enqueue({ listId, sectionId: firstSectionId(app.sections, listId) })}
          />
          <Choice
            stack
            label="Section"
            value={task.sectionId ?? ""}
            options={app.sections
              .filter((section) => section.listId === task.listId)
              .map((section) => ({ value: section.id, label: section.name }))}
            onChange={(sectionId) => enqueue({ sectionId: sectionId || null })}
          />
          <Choice
            stack
            label="Priority"
            value={task.priority}
            options={[
              { value: "none", label: "None" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
            onChange={(priority) => enqueue({ priority: priority as Priority })}
          />
          <div className="task-dates">
            <Field
              label="Start"
              type="date"
              value={task.startOn ?? ""}
              onChange={(event) => enqueue({ startOn: event.target.value || null })}
            />
            <Field
              label="Due"
              type="date"
              value={task.dueOn ?? ""}
              onChange={(event) => enqueue({ dueOn: event.target.value || null })}
            />
          </div>
          <Field
            label="Time"
            value={timeText}
            placeholder={app.settings.clock === "12" ? "6:00 PM" : "18:00"}
            onChange={(event) => setTimeText(event.target.value)}
            onBlur={() => {
              const parsed = parseClock(timeText);
              if (timeText.trim() && parsed === null) {
                setTimeText(task.dueTime ? formatClock(task.dueTime, app.settings.clock) : "");
                return;
              }
              setTimeText(parsed ? formatClock(parsed, app.settings.clock) : "");
              if (parsed !== task.dueTime) enqueue({ dueTime: parsed });
            }}
          />
          <Field
            label="Duration minutes"
            inputMode="numeric"
            value={duration}
            hint={error && error.startsWith("Duration") ? error : undefined}
            onChange={(event) => setDuration(event.target.value)}
            onBlur={() => {
              const parsed = cleanDuration(duration);
              if ("error" in parsed) {
                setError(parsed.error);
                setNotSaved(true);
                return;
              }
              setDuration(parsed.minutes === null ? "" : String(parsed.minutes));
              if (parsed.minutes !== task.durationMinutes) enqueue({ durationMinutes: parsed.minutes });
            }}
          />
          <CheckField label="Important" checked={task.important} onChange={(important) => enqueue({ important })} />
          <CheckField label="Urgent" checked={task.urgent} onChange={(urgent) => enqueue({ urgent })} />
          <CheckField label="Pinned" checked={task.pinned} onChange={(pinned) => enqueue({ pinned })} />
          <ReminderEditor taskId={task.id} dueOn={task.dueOn} onChanged={() => app.bump()} />
          <TagPicker taskId={task.id} />
          <Area
            label="Notes"
            value={notes}
            maxLength={100000}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => saveNotes(notes)}
          />
          <ChecklistRows taskId={task.id} notes={notes} onNotes={setNotes} />
          <details className="fold">
            <summary>Files</summary>
            <TaskFiles taskId={task.id} />
          </details>
          <details className="fold">
            <summary>Recurrence</summary>
            {describeRecurrence(task.recurrenceJson) ?? <p className="meta">Does not repeat.</p>}
          </details>
          <details className="fold">
            <summary>Estimate</summary>
            <div className="grid gap-2 pb-2">
              <Field
                label="Estimated pomodoros"
                inputMode="numeric"
                value={estimate}
                onChange={(event) => setEstimate(event.target.value)}
                onBlur={() => {
                  const trimmed = estimate.trim();
                  const parsed = trimmed ? Number(trimmed) : null;
                  if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 99)) {
                    setError("Estimated pomodoros can be 1 to 99.");
                    setEstimate(task.estimatedPomos === null ? "" : String(task.estimatedPomos));
                    return;
                  }
                  if (parsed !== task.estimatedPomos) enqueue({ estimatedPomos: parsed });
                }}
              />
              <p className="meta">
                Completed pomodoros {task.completedPomos}
                {task.estimatedPomos ? ` of ${task.estimatedPomos}` : ""}
              </p>
            </div>
          </details>
          <details className="fold">
            <summary>Subtasks</summary>
            <Subtasks parent={task} />
          </details>
          <details className="fold">
            <summary>History</summary>
            <HistoryList taskId={task.id} />
          </details>
          {error && !error.startsWith("Duration") ? <p className="meta text-danger">{error}</p> : null}
          {notSaved ? (
            <Button variant="secondary" onClick={() => enqueue({ title, notes })}>
              Retry
            </Button>
          ) : null}
        </div>
      )}
      {confirmTrash && task ? (
        <Dialog title="Move to trash?" onClose={() => setConfirmTrash(false)}>
          <p>
            {children > 0
              ? "This removes the task from Today and lists. Tasks directly under it stay on this list and stop being subtasks."
              : "This removes the task from Today and lists. It stays in the database."}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              onClick={() => {
                void trashTask(task.id).then((result) => {
                  if (result.status === "saved") {
                    app.setOpenTaskId(null);
                    app.bump();
                  } else setNotSaved(true);
                  setConfirmTrash(false);
                });
              }}
            >
              Move to trash
            </Button>
            <Button variant="secondary" onClick={() => setConfirmTrash(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      ) : null}
      {conflict ? (
        <Dialog title="Not saved" onClose={() => setConflict(null)}>
          <p>This was saved from a newer edit. Your latest keystrokes are still in the form.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => {
                setConflict(null);
                enqueue({ title, notes }, true);
              }}
            >
              Keep mine
            </Button>
            <Button variant="secondary" onClick={() => adopt(conflict)}>
              Use saved
            </Button>
          </div>
        </Dialog>
      ) : null}
    </aside>
  );
}

function describeRecurrence(json: string | null) {
  const rule = json ? parseRule(json) : null;
  if (!rule) return null;
  return <p className="meta">{describeRule(rule)}</p>;
}

