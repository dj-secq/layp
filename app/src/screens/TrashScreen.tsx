import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Skeleton, useViewLoad } from "../components/Skeleton";
import { Dialog } from "../components/Dialog";
import { emptyTrash, purgeTask, restoreTask, trashedTasks } from "../db/tasks";
import type { Task } from "../db/types";
import { useApp } from "../state/AppState";

export function TrashScreen() {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const view = useViewLoad("trash");

  useEffect(() => {
    let cancel = false;
    trashedTasks()
      .then((rows) => {
        if (!cancel) view.settle(() => setTasks(rows));
      })
      .catch(() => {
        if (!cancel) view.settle(() => setError("Not saved"));
      });
    return () => {
      cancel = true;
    };
  }, [app.revision]);

  return (
    <>
      <header className="screen-head">
        <h1 className="page-title">Trash</h1>
      </header>
      <div className="grid max-w-3xl gap-4">
      {!view.ready ? <Skeleton kind="rows" label="Loading trash" /> : null}
      {view.ready && tasks.length > 0 ? (
        <div>
          <Button variant="danger" onClick={() => setConfirmEmpty(true)}>
            Empty trash
          </Button>
        </div>
      ) : null}
      {error ? <p className="meta text-danger">{error}</p> : null}
      {view.ready && tasks.length === 0 ? <p>Trash is empty.</p> : null}
      {view.ready ? tasks.map((task) => (
        <div key={task.id} className="task-row">
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          <Button
            small
            onClick={() => {
              void restoreTask(task.id).then((result) => {
                if (result.status === "saved") app.bump();
                else setError("Not saved");
              });
            }}
          >
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
            Restore
          </Button>
          <Button
            small
            variant="danger"
            onClick={() => {
              void purgeTask(task.id).then((result) => {
                if (result.status === "saved") app.bump();
                else setError("Not saved");
              });
            }}
          >
            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
            Delete permanently
          </Button>
        </div>
      )) : null}
      {confirmEmpty ? (
        <Dialog title="Empty trash?" onClose={() => setConfirmEmpty(false)}>
          <p>This permanently deletes every task in the trash.</p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              onClick={() => {
                void emptyTrash().then((result) => {
                  setConfirmEmpty(false);
                  if (result.status === "saved") app.bump();
                  else setError("Not saved");
                });
              }}
            >
              Empty trash
            </Button>
            <Button variant="secondary" onClick={() => setConfirmEmpty(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      ) : null}
      </div>
    </>
  );
}
