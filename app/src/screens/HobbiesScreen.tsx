import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { Dialog } from "../components/Dialog";
import { Field } from "../components/Field";
import {
  archiveTracker,
  createHobby,
  deleteHobby,
  hobbyNotes,
  loadTrackers,
  logsForTracker,
  restoreTracker,
  type Tracker,
  type TrackerLog,
} from "../db/trackers";
import { sumMinutes, weekBounds, weekBuckets } from "../lib/journal";
import { DEFAULT_LIST_COLOR, STICKERS, stickerName } from "../lib/stickers";
import { useApp } from "../state/AppState";

export function HobbiesScreen() {
  const app = useApp();
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = useViewLoad("hobbies");

  useEffect(() => {
    app.bindScreen({ taskIds: [], toggleTask() {} });
  }, [app]);

  useEffect(() => {
    let cancel = false;
    loadTrackers(true)
      .then((rows) => {
        if (cancel) return;
        view.settle(() => {
          const hobbies = rows.filter((row) => row.isHobby);
          setTrackers(hobbies);
          setSelectedId((current) => current ?? hobbies.find((row) => !row.archivedAt)?.id ?? null);
          setError(null);
        });
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [app.revision]);

  const active = trackers.filter((tracker) => !tracker.archivedAt);
  const archived = trackers.filter((tracker) => tracker.archivedAt);
  const selected = active.find((tracker) => tracker.id === selectedId) ?? null;

  return (
    <section className="grid min-w-0 gap-4" aria-label="Hobbies">
      <h1 className="page-title screen-head">Hobbies</h1>
      {error ? <p className="meta text-danger">{error}</p> : null}
      {view.ready && active.length === 0 ? <p>Add a hobby with a name and a color.</p> : null}
      <AddHobby />
      {!view.ready ? <Skeleton kind="cards" label="Loading hobbies" /> : null}
      {view.ready ? <div className="grid gap-3">
        {active.map((hobby) => (
          <HobbyCard
            key={hobby.id}
            hobby={hobby}
            selected={hobby.id === selected?.id}
            onSelect={() => setSelectedId(hobby.id)}
            onArchive={() => {
              void archiveTracker(hobby).then((result) => {
                if (result.status === "saved") app.bump();
                else setError(result.status === "error" ? result.message : "Not saved");
              });
            }}
          />
        ))}
      </div> : null}
      {view.ready && selected ? <HobbyDetail hobby={selected} onDeleted={() => setSelectedId(null)} /> : null}
      {view.ready && archived.length > 0 ? (
        <div className="grid gap-2">
          <p className="section-label">Archived</p>
          <p className="meta">Archive keeps the log. Restore puts the hobby back on the day page.</p>
          {archived.map((hobby) => (
            <div key={hobby.id} className="flex items-center justify-between gap-2">
              <span>{hobby.name}</span>
              <Button
                variant="secondary"
                onClick={() => {
                  void restoreTracker(hobby).then((result) => {
                    if (result.status === "saved") app.bump();
                    else setError("Not saved");
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

function HobbyCard({
  hobby,
  selected,
  onSelect,
  onArchive,
}: {
  hobby: Tracker;
  selected: boolean;
  onSelect: () => void;
  onArchive: () => void;
}) {
  const app = useApp();
  const [logs, setLogs] = useState<TrackerLog[]>([]);

  useEffect(() => {
    let cancel = false;
    logsForTracker(hobby.id)
      .then((rows) => {
        if (!cancel) setLogs(rows);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [hobby.id, app.revision]);

  const today = Temporal.PlainDate.from(app.civilToday);
  const week = weekBounds(app.civilToday, app.settings.weekStart);
  const monthStart = Temporal.PlainDate.from({ year: today.year, month: today.month, day: 1 }).toString();
  const monthEnd = today.with({ day: today.daysInMonth }).toString();
  const yearStart = `${today.year}-01-01`;
  const yearEnd = `${today.year}-12-31`;

  return (
    <article className="panel grid gap-2" data-selected={selected}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="flex items-center gap-2 font-bold" onClick={onSelect}>
          <span className="priority-mark" style={{ background: hobby.color }} aria-hidden />
          {hobby.name}
        </button>
        <Button variant="secondary" onClick={onArchive}>
          Archive
        </Button>
      </div>
      <p className="nums">
        {sumMinutes(logs, week.start, week.end)} this week · {sumMinutes(logs, monthStart, monthEnd)} this month ·{" "}
        {sumMinutes(logs, yearStart, yearEnd)} this year
      </p>
    </article>
  );
}

function HobbyDetail({ hobby, onDeleted }: { hobby: Tracker; onDeleted: () => void }) {
  const app = useApp();
  const [logs, setLogs] = useState<TrackerLog[]>([]);
  const [notes, setNotes] = useState<TrackerLog[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let cancel = false;
    Promise.all([logsForTracker(hobby.id), hobbyNotes(hobby.id, null, 30)])
      .then(([all, page]) => {
        if (cancel) return;
        setLogs(all);
        setNotes(page);
        setBefore(page.length > 0 ? page[page.length - 1].day : null);
        setMore(page.length === 30);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [hobby.id, app.revision]);

  const buckets = weekBuckets(app.civilToday, app.settings.weekStart, 12);
  const totals = buckets.map((bucket) => sumMinutes(logs, bucket.start, bucket.end));
  const peak = Math.max(1, ...totals);

  return (
    <section className="panel grid gap-3" aria-label={`${hobby.name} detail`}>
      <h2 className="page-title">{hobby.name}</h2>
      <div className="week-bar" aria-label="12 week minutes">
        {buckets.map((bucket, index) => (
          <span key={bucket.start} style={{ height: `${Math.max(8, (totals[index] / peak) * 100)}%` }} title={`${totals[index]} minutes`}>
            <span className="sr-only">
              {bucket.start} {totals[index]} minutes
            </span>
          </span>
        ))}
      </div>
      <p className="nums">{totals.join(" · ")}</p>
      <div className="grid gap-2">
        {notes.length === 0 ? <p className="meta">No notes yet.</p> : null}
        {notes.map((note) => (
          <p key={note.id}>
            <span className="meta nums">{note.day}</span>
            <br />
            {note.note}
          </p>
        ))}
        {more && before ? (
          <Button
            variant="secondary"
            onClick={() => {
              void hobbyNotes(hobby.id, before, 30).then((page) => {
                setNotes((current) => [...current, ...page]);
                setBefore(page.length > 0 ? page[page.length - 1].day : before);
                setMore(page.length === 30);
              });
            }}
          >
            Older notes
          </Button>
        ) : null}
      </div>
      <div>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Delete
        </Button>
      </div>
      {confirm ? (
        <DeleteHobby
          hobby={hobby}
          onClose={() => setConfirm(false)}
          onDeleted={() => {
            setConfirm(false);
            onDeleted();
            app.bump();
          }}
        />
      ) : null}
    </section>
  );
}

function DeleteHobby({ hobby, onClose, onDeleted }: { hobby: Tracker; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim() === hobby.name;

  return (
    <Dialog title={`Delete ${hobby.name}?`} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          void deleteHobby(hobby, typed).then((result) => {
            if (result.status === "saved") onDeleted();
            else setError(result.status === "error" ? result.message : "Not saved");
          });
        }}
      >
        <p>Type {hobby.name} to delete this hobby and its log. Archive keeps the log.</p>
        <Field label="Hobby name" value={typed} onChange={(event) => setTyped(event.target.value)} />
        {error ? <p className="meta text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="danger" type="submit" disabled={!ready}>
            Delete hobby
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddHobby() {
  const app = useApp();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_LIST_COLOR);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="panel grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void createHobby(name, color).then((result) => {
          if (result.status !== "saved") {
            setError(result.status === "error" ? result.message : "Not saved");
            return;
          }
          setName("");
          setError(null);
          app.bump();
        });
      }}
    >
      <Field label="Name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
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
      {error ? <p className="meta text-danger">{error}</p> : null}
      <div>
        <Button variant="primary" type="submit">
          Add a hobby
        </Button>
      </div>
    </form>
  );
}
