import { useEffect, useState } from "react";
import { searchAll, type DayHit, type SearchHit } from "../db/search";
import { useApp } from "../state/AppState";

export function SearchScreen() {
  const app = useApp();
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState<SearchHit[]>([]);
  const [days, setDays] = useState<DayHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      setTasks([]);
      setDays([]);
      return;
    }
    let cancel = false;
    const handle = window.setTimeout(() => {
      searchAll(trimmed)
        .then((result) => {
          if (cancel) return;
          setTasks(result.tasks);
          setDays(result.days);
          setError(null);
        })
        .catch(() => {
          if (!cancel) setError("Not saved");
        });
    }, 200);
    return () => {
      cancel = true;
      window.clearTimeout(handle);
    };
  }, [text]);

  return (
    <>
      <h1 className="page-title screen-head">Search</h1>
      <div className="grid max-w-3xl gap-4">
      <input
        id="search"
        className="field"
        autoFocus
        value={text}
        placeholder="Tasks, notes, diary"
        aria-label="Search"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && app.layers === 0 && !app.openTaskId) {
            event.preventDefault();
            event.stopPropagation();
            setText("");
          }
        }}
      />
      {error ? <p className="meta text-danger">{error}</p> : null}
      {text.trim() && tasks.length === 0 && days.length === 0 && !error ? <p>Nothing matches.</p> : null}
      {tasks.length > 0 ? (
        <section>
          <h2 className="group-label">Tasks</h2>
          {tasks.map((task) => (
            <button key={task.id} type="button" className="task-row w-full text-left" onClick={() => app.setOpenTaskId(task.id)}>
              <span
                className="row-accent"
                style={{ background: app.lists.find((list) => list.name === task.listName)?.color ?? "var(--ink-soft)" }}
                aria-hidden
              />
              <span className="task-title min-w-0 flex-1 truncate">{task.title}</span>
              <span className="meta shrink-0">{task.listName}</span>
            </button>
          ))}
        </section>
      ) : null}
      {days.length > 0 ? (
        <section>
          <h2 className="group-label">Days</h2>
          {days.map((day) => (
            <button key={day.day} type="button" className="task-row w-full text-left" onClick={() => app.goToday(day.day)}>
              <span className="task-title">{day.day}</span>
              <span className="meta">{day.label}</span>
            </button>
          ))}
        </section>
      ) : null}
      </div>
    </>
  );
}
