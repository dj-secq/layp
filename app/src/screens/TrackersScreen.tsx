import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { Choice } from "../components/Choice";
import { Field } from "../components/Field";
import {
  archiveTracker,
  clearLog,
  createTracker,
  loadTrackers,
  logsBetween,
  logsForTracker,
  restoreTracker,
  upsertLog,
  type Tracker,
  type TrackerLog,
} from "../db/trackers";
import { monthCells, monthLabel, shiftMonth, weekdayLabels } from "../lib/dates";
import { cellScheduled, streak, type Schedule, type TrackerKind } from "../lib/journal";
import { DEFAULT_LIST_COLOR, STICKERS, stickerName } from "../lib/stickers";
import { useApp } from "../state/AppState";

const KINDS: Array<{ id: TrackerKind; label: string }> = [
  { id: "check", label: "Check" },
  { id: "count", label: "Count" },
  { id: "number", label: "Number" },
  { id: "scale", label: "Scale" },
  { id: "minutes", label: "Minutes" },
];

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TrackersScreen() {
  const app = useApp();
  const today = Temporal.PlainDate.from(app.civilToday);
  const [cursor, setCursor] = useState({ year: today.year, month: today.month });
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [logs, setLogs] = useState<TrackerLog[]>([]);
  const [streaks, setStreaks] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const view = useViewLoad(`${cursor.year}-${cursor.month}`);
  const [edit, setEdit] = useState<{ trackerId: string; day: string } | null>(null);

  useEffect(() => {
    app.bindScreen({ taskIds: [], toggleTask() {} });
  }, [app]);

  useEffect(() => {
    const first = Temporal.PlainDate.from({ year: cursor.year, month: cursor.month, day: 1 });
    const from = first.toString();
    const to = first.with({ day: first.daysInMonth }).toString();
    let cancel = false;
    Promise.all([loadTrackers(true), logsBetween(from, to)])
      .then(async ([nextTrackers, nextLogs]) => {
        if (cancel) return;
        const activeRows = nextTrackers.filter((tracker) => !tracker.isHobby && !tracker.archivedAt);
        const pairs = await Promise.all(activeRows.map(async (tracker) => [tracker.id, await logsForTracker(tracker.id)] as const));
        if (cancel) return;
        view.settle(() => {
          setTrackers(nextTrackers);
          setLogs(nextLogs);
          setStreaks(
            new Map(
              pairs.map(([id, rows]) => {
                const tracker = activeRows.find((item) => item.id === id);
                if (!tracker) return [id, ""];
                return [
                  id,
                  streak({
                    kind: tracker.kind,
                    dailyTarget: tracker.dailyTarget,
                    schedule: tracker.schedule,
                    logs: rows,
                    today: app.civilToday,
                    weekStart: app.settings.weekStart,
                  }).label,
                ];
              }),
            ),
          );
          setError(null);
        });
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [cursor.year, cursor.month, app.revision, app.civilToday, app.settings.weekStart]);

  const active = trackers.filter((tracker) => !tracker.isHobby && !tracker.archivedAt);
  const archived = trackers.filter((tracker) => !tracker.isHobby && tracker.archivedAt);
  const cells = monthCells(cursor.year, cursor.month, app.settings.weekStart);

  return (
    <section className="grid min-w-0 gap-4" aria-label="Trackers">
      <header className="screen-head">
        <h1 className="page-title">Trackers</h1>
      </header>
      <div className="page-head">
        <div className="page-tools">
          <Button small aria-label="Previous month" onClick={() => setCursor((current) => shiftMonth(current.year, current.month, -1))}>
            <ChevronLeft size={16} aria-hidden />
          </Button>
          <span className="font-bold">{monthLabel(cursor.year, cursor.month)}</span>
          <Button small aria-label="Next month" onClick={() => setCursor((current) => shiftMonth(current.year, current.month, 1))}>
            <ChevronRight size={16} aria-hidden />
          </Button>
        </div>
      </div>
      <p>Sleep and workout already live on the day page.</p>
      {error ? <p className="meta text-danger">{error}</p> : null}
      <AddTracker onError={setError} />
      {!view.ready ? <Skeleton kind="cards" label="Loading trackers" /> : null}
      {view.ready && active.length === 0 ? <p className="meta">Add a row to start a tracker.</p> : null}
      {view.ready ? active.map((tracker) => (
        <article key={tracker.id} className="panel grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[18px] font-bold">
              {tracker.name}{" "}
              <span className="meta">
                {tracker.kind} · {streaks.get(tracker.id) ?? ""}
              </span>
            </h2>
            <Button
              variant="secondary"
              onClick={() => {
                void archiveTracker(tracker).then((result) => {
                  if (result.status === "saved") app.bump();
                  else setError(result.status === "error" ? result.message : "Not saved");
                });
              }}
            >
              Archive
            </Button>
          </div>
          <div className="tracker-grid">
            {weekdayLabels(app.settings.weekStart).map((label) => (
              <span key={label} className="meta text-center">
                {label}
              </span>
            ))}
            {cells.map((iso, index) =>
              iso && cellScheduled(tracker.schedule, iso) ? (
                <TrackerCell
                  key={iso}
                  tracker={tracker}
                  iso={iso}
                  today={app.civilToday}
                  log={logs.find((item) => item.trackerId === tracker.id && item.day === iso)}
                  onCheck={async (next) => {
                    const result =
                      next === "clear"
                        ? await clearLog(tracker.id, iso)
                        : await upsertLog(tracker, iso, { state: next, valueText: "", note: "" });
                    if (result.status === "saved") app.bump();
                    else setError(result.status === "error" ? result.message : "Not saved");
                  }}
                  onEdit={() => setEdit({ trackerId: tracker.id, day: iso })}
                />
              ) : (
                <span key={iso ?? `blank-${index}`} />
              ),
            )}
          </div>
          {edit?.trackerId === tracker.id ? (
            <LogEditor
              tracker={tracker}
              day={edit.day}
              log={logs.find((item) => item.trackerId === tracker.id && item.day === edit.day)}
              onClose={() => setEdit(null)}
              onError={setError}
            />
          ) : null}
        </article>
      )) : null}
      {view.ready && archived.length > 0 ? (
        <div className="grid gap-2">
          <p className="section-label">Archived</p>
          {archived.map((tracker) => (
            <div key={tracker.id} className="flex items-center justify-between gap-2">
              <span>{tracker.name}</span>
              <Button
                variant="secondary"
                onClick={() => {
                  void restoreTracker(tracker).then((result) => {
                    if (result.status === "saved") app.bump();
                    else setError(result.status === "error" ? result.message : "Not saved");
                  });
                }}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TrackerCell({
  tracker,
  iso,
  today,
  log,
  onCheck,
  onEdit,
}: {
  tracker: Tracker;
  iso: string;
  today: string;
  log: TrackerLog | undefined;
  onCheck: (next: "done" | "skipped" | "clear") => void;
  onEdit: () => void;
}) {
  const state = log?.state;
  const label = `${tracker.name} ${iso}${state === "done" ? ", done" : state === "skipped" ? ", skipped" : ""}`;
  const mark = state === "done" ? "✓" : state === "skipped" ? "–" : iso === today ? "·" : "";
  if (tracker.kind === "check") {
    const next = state === "done" ? "skipped" : state === "skipped" ? "clear" : "done";
    return (
      <button
        type="button"
        className="tracker-cell"
        aria-label={label}
        aria-pressed={state === "done"}
        data-filled={state === "done" ? "true" : "false"}
        style={{
          background: state === "done" ? "var(--primary)" : state === "skipped" ? "var(--muted)" : undefined,
          color: state === "done" ? "#111" : undefined,
          borderColor: state === "done" ? "var(--primary)" : undefined,
          borderWidth: state === "done" ? 2 : undefined,
        }}
        onClick={() => onCheck(next)}
      >
        {mark}
      </button>
    );
  }
  const value = state === "done" && log?.value !== null && log?.value !== undefined ? String(log.value) : mark;
  return (
    <button
      type="button"
      className="tracker-cell nums"
      aria-label={label}
      data-filled={state === "done" ? "true" : "false"}
      style={{
        background: state === "done" ? tracker.color : state === "skipped" ? "var(--muted)" : undefined,
        color: state === "done" ? "#111" : undefined,
        borderColor: state === "done" ? tracker.color : undefined,
        borderWidth: state === "done" ? 2 : undefined,
      }}
      onClick={onEdit}
    >
      {value}
    </button>
  );
}

function LogEditor({
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
  onError: (message: string | null) => void;
}) {
  const app = useApp();
  const [value, setValue] = useState(log?.state === "done" && log.value !== null ? String(log.value) : "");
  const [note, setNote] = useState(log?.note ?? "");
  const [rowError, setRowError] = useState<string | null>(null);

  async function save(state: "done" | "skipped") {
    const result = await upsertLog(tracker, day, { state, valueText: state === "skipped" ? "" : value, note });
    if (result.status === "saved") {
      app.bump();
      onClose();
      return;
    }
    const message = result.status === "error" ? result.message : "Not saved";
    setRowError(message);
    onError(message);
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save("done");
      }}
    >
      <Field label={tracker.unit ? `Value (${tracker.unit})` : "Value"} value={value} onChange={(event) => setValue(event.target.value)} />
      <Field label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      {rowError ? (
        <p className="meta text-danger">
          {rowError}{" "}
          <button type="button" className="underline" onClick={() => void save("done")}>
            Retry
          </button>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="submit">
          Save
        </Button>
        <Button variant="secondary" onClick={() => void save("skipped")}>
          Skip
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void clearLog(tracker.id, day).then((result) => {
              if (result.status === "saved") {
                app.bump();
                onClose();
              } else setRowError("Not saved");
            });
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

function AddTracker({ onError }: { onError: (message: string | null) => void }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TrackerKind>("check");
  const [unit, setUnit] = useState("");
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<Schedule["type"]>("daily");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [count, setCount] = useState("4");
  const [color, setColor] = useState(DEFAULT_LIST_COLOR);
  const [rowError, setRowError] = useState<string | null>(null);

  const schedule: Schedule =
    mode === "weekdays" ? { type: "weekdays", days } : mode === "weekly_count" ? { type: "weekly_count", count: Number(count) } : { type: "daily" };

  async function add() {
    const result = await createTracker({ name, kind, unit, target, schedule, color });
    if (result.status !== "saved") {
      const message = result.status === "error" ? result.message : "Not saved";
      setRowError(message);
      onError(message);
      return;
    }
    setName("");
    setRowError(null);
    app.bump();
  }

  return (
    <form
      className="panel grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Field label="Name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      <Choice
        stack
        label="Kind"
        value={kind}
        options={KINDS.map((item) => ({ value: item.id, label: item.label }))}
        onChange={(value) => setKind(value as TrackerKind)}
      />
      {kind === "number" ? <Field label="Unit" value={unit} maxLength={20} onChange={(event) => setUnit(event.target.value)} /> : null}
      {kind === "count" || kind === "number" || kind === "minutes" ? (
        <Field label="Target" value={target} onChange={(event) => setTarget(event.target.value)} />
      ) : null}
      <Choice
        stack
        label="Schedule"
        value={mode}
        options={[
          { value: "daily", label: "Every day" },
          { value: "weekdays", label: "Chosen days" },
          { value: "weekly_count", label: "Weekly count" },
        ]}
        onChange={(value) => setMode(value as Schedule["type"])}
      />
      {mode === "weekdays" ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Days">
          {WEEKDAY_NAMES.map((label, index) => {
            const day = index + 1;
            const on = days.includes(day);
            return (
              <Button
                key={label}
                small
                variant={on ? "primary" : "secondary"}
                aria-pressed={on}
                onClick={() => setDays((current) => (on ? current.filter((item) => item !== day) : [...current, day]))}
              >
                {label}
              </Button>
            );
          })}
        </div>
      ) : null}
      {mode === "weekly_count" ? <Field label="Days each week" value={count} onChange={(event) => setCount(event.target.value)} /> : null}
      <div className="flex flex-wrap gap-2">
        {STICKERS.map((sticker) => (
          <button
            key={sticker.hex}
            type="button"
            className="swatch press-sm"
            style={{ background: sticker.hex }}
            aria-label={stickerName(sticker.hex)}
            aria-pressed={color === sticker.hex}
            onClick={() => setColor(sticker.hex)}
          />
        ))}
      </div>
      {rowError ? <p className="meta text-danger">{rowError}</p> : null}
      <div>
        <Button variant="primary" type="submit">
          Add a row
        </Button>
      </div>
    </form>
  );
}
