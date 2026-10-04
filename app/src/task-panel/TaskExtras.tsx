import { Plus, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { useFocus } from "../components/FocusTimer";
import { historyForTask, type HistoryRow } from "../db/history";
import { createTag, loadTags, setTaskTag, tagsForTask, type Tag } from "../db/tags";
import { completeTask, createTask, reopenTask, tasksPresent } from "../db/tasks";
import type { Task } from "../db/types";
import { STICKERS } from "../lib/stickers";
import { subtaskTree, type SubtaskNode } from "../lib/subtasks";
import { useApp } from "../state/AppState";

export function TagPicker({ taskId }: { taskId: string }) {
  const app = useApp();
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(STICKERS[0].hex);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    Promise.all([loadTags(), tagsForTask(taskId)])
      .then(([all, mine]) => {
        if (cancel) return;
        setTags(all);
        setSelected(mine.map((tag) => tag.id));
      })
      .catch(() => {
        if (!cancel) setError("Not saved");
      });
    return () => {
      cancel = true;
    };
  }, [taskId]);

  async function toggle(tagId: string) {
    const on = !selected.includes(tagId);
    const result = await setTaskTag(taskId, tagId, on);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setSelected((current) => (on ? [...current, tagId] : current.filter((id) => id !== tagId)));
    app.bump();
  }

  async function add() {
    const result = await createTag(name, color);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    const linked = await setTaskTag(taskId, result.row.id, true);
    if (linked.status !== "saved") {
      setError("Not saved");
      return;
    }
    setTags((current) => [...current, result.row].sort((a, b) => a.name.localeCompare(b.name)));
    setSelected((current) => [...current, result.row.id]);
    setName("");
    app.bump();
  }

  return (
    <div className="grid gap-2">
      <span className="label">Tags</span>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="press-sm px-2"
            aria-pressed={selected.includes(tag.id)}
            style={{
              background: selected.includes(tag.id) ? tag.color : "transparent",
              color: selected.includes(tag.id) ? "#111111" : "var(--ink)",
              border: "1px solid var(--border)",
            }}
            onClick={() => void toggle(tag.id)}
          >
            {tag.name}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-end gap-2">
        <label className="grid w-full min-w-0 gap-1">
          <span className="label">New tag</span>
          <input className="field" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="tag-colors" role="group" aria-label="Tag color">
          {STICKERS.map((sticker) => (
            <button
              key={sticker.hex}
              type="button"
              className="swatch"
              aria-label={sticker.name}
              aria-pressed={color === sticker.hex}
              style={{ background: sticker.hex }}
              onClick={() => setColor(sticker.hex)}
            />
          ))}
        </div>
        <Button small onClick={() => void add()}>
          Add tag
        </Button>
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
    </div>
  );
}

export function Subtasks({ parent }: { parent: Task }) {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    tasksPresent()
      .then((rows) => {
        if (!cancel) setTasks(rows);
      })
      .catch(() => {
        if (!cancel) setError("Not saved");
      });
    return () => {
      cancel = true;
    };
  }, [parent.id, app.revision]);

  const nodes = subtaskTree(tasks, parent.id);

  return (
    <div className="grid gap-2">
      <span className="label">Subtasks</span>
      {nodes.map((node) => (
        <SubtaskBranch key={node.task.id} node={node} depth={0} onError={setError} />
      ))}
      <AddSubtask parent={parent} onError={setError} />
      {error ? <p className="meta text-danger">{error}</p> : null}
    </div>
  );
}

function SubtaskBranch({
  node,
  depth,
  onError,
}: {
  node: SubtaskNode<Task>;
  depth: number;
  onError: (message: string | null) => void;
}) {
  const app = useApp();
  const task = node.task;
  const [adding, setAdding] = useState(false);

  return (
    <div className="grid gap-2" style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(task.completedAt)}
          aria-label={task.completedAt ? `Reopen ${task.title}` : `Complete ${task.title}`}
          onChange={() => {
            void (task.completedAt ? reopenTask(task.id) : completeTask(task.id)).then((result) => {
              if (result.status === "saved") app.bump();
              else onError("Not saved");
            });
          }}
        />
        <button
          type="button"
          className={task.completedAt ? "min-w-0 flex-1 text-left line-through" : "min-w-0 flex-1 text-left"}
          onClick={() => app.setOpenTaskId(task.id)}
        >
          {task.title}
        </button>
        <Button small onClick={() => setAdding((open) => !open)} aria-expanded={adding}>
          <Plus size={14} strokeWidth={1.75} aria-hidden />
          {adding ? "Cancel" : "Add subtask"}
        </Button>
      </div>
      {adding ? <AddSubtask parent={task} onError={onError} /> : null}
      {node.children.map((child) => (
        <SubtaskBranch key={child.task.id} node={child} depth={depth + 1} onError={onError} />
      ))}
    </div>
  );
}

function AddSubtask({ parent, onError }: { parent: Task; onError: (message: string | null) => void }) {
  const app = useApp();
  const [title, setTitle] = useState("");

  return (
    <div className="flex gap-2">
      <input
        className="field"
        value={title}
        placeholder="Add a subtask"
        aria-label={`Add a subtask under ${parent.title}`}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button
        small
        onClick={() => {
          void createTask({ title, listId: parent.listId, sectionId: parent.sectionId, parentId: parent.id }).then((result) => {
            if (result.status === "saved") {
              setTitle("");
              onError(null);
              app.bump();
            } else onError(result.status === "error" ? result.message : "Not saved");
          });
        }}
      >
        Add subtask
      </Button>
    </div>
  );
}

export function HistoryList({ taskId }: { taskId: string }) {
  const app = useApp();
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    let cancel = false;
    historyForTask(taskId)
      .then((next) => {
        if (!cancel) setRows(next);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [taskId, app.revision]);

  if (rows.length === 0) return null;
  return (
    <div className="grid gap-1">
      <span className="label">History</span>
      {rows.map((row) => (
        <p key={row.id} className="meta">
          {row.summary} · {row.at.slice(0, 16).replace("T", " ")}
        </p>
      ))}
    </div>
  );
}

export function StartFocus({ taskId, completed }: { taskId: string; completed: boolean }) {
  const focus = useFocus();
  if (completed || focus.timer.phase !== "idle") return null;
  return (
    <Button variant="secondary" onClick={() => focus.start(taskId)}>
      <Timer size={16} strokeWidth={1.75} aria-hidden />
      Start focus
    </Button>
  );
}
