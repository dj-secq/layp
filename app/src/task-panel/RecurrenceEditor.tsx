import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "../components/Button";
import { Choice } from "../components/Choice";
import { Field } from "../components/Field";
import type { TaskPatch } from "../db/tasks";
import type { Task } from "../db/types";
import { describeRule, parseRule, type WeekdayCode } from "@layp/shared";
import { draftFromRule, recurrenceDraftError, recurrenceSave, type RecurrenceDraft } from "@layp/shared";

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
  onSave: (patch: TaskPatch) => void;
}) {
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
    const time = Temporal.Now.plainTimeISO();
    onSave(recurrenceSave(next, { dueOn: task.dueOn, dueTime: task.dueTime }, today, time.hour * 60 + time.minute));
  }

  function update(next: RecurrenceDraft) {
    if (locked) return;
    setDraft(next);
    if (next.freq === "none" && task.recurrenceJson !== null) save(next);
  }

  return (
    <div className="grid gap-2 pb-2">
      <p className="meta">{savedRule ? describeRule(savedRule) : "Does not repeat."}</p>
      <Choice
        stack
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
          <Field
            label="Interval"
            inputMode="numeric"
            value={draft.interval}
            disabled={locked}
            onChange={(event) => update({ ...draft, interval: event.target.value })}
          />
          {draft.freq === "weekly" ? (
            <div className="grid gap-1">
              <span className="label">Weekdays</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Weekdays">
                {WEEKDAYS.map((day) => {
                  const on = draft.weekdays.includes(day.code);
                  return (
                    <Button
                      key={day.code}
                      small
                      variant={on ? "primary" : "secondary"}
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => update({ ...draft, weekdays: toggleWeekday(draft.weekdays, day.code) })}
                    >
                      {day.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {draft.freq === "monthly" || draft.freq === "yearly" ? (
            <Field
              label="Month day"
              inputMode="numeric"
              placeholder="Day of the due date"
              value={draft.monthDay}
              disabled={locked}
              onChange={(event) => update({ ...draft, monthDay: event.target.value })}
            />
          ) : null}
          <Choice
            stack
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
            stack
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
            <Field
              label="End date"
              type="date"
              value={draft.endDate}
              disabled={locked}
              onChange={(event) => update({ ...draft, endDate: event.target.value })}
            />
          ) : null}
          {draft.end === "count" ? (
            <Field
              label="Count"
              inputMode="numeric"
              value={draft.endCount}
              disabled={locked}
              onChange={(event) => update({ ...draft, endCount: event.target.value })}
            />
          ) : null}
          <div>
            <Button variant="primary" disabled={locked || error !== null} onClick={() => save(draft)}>
              Save repeat
            </Button>
          </div>
        </>
      )}
      {error ? <p className="meta text-danger">{error}</p> : null}
    </div>
  );
}

function toggleWeekday(days: WeekdayCode[], code: WeekdayCode): WeekdayCode[] {
  const next = days.includes(code) ? days.filter((day) => day !== code) : [...days, code];
  return WEEKDAYS.map((day) => day.code).filter((day) => next.includes(day));
}
