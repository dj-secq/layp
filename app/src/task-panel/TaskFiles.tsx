import { open } from "@tauri-apps/plugin-dialog";
import { FileText, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { addAttachment, attachmentsForTask, removeAttachment, type Attachment } from "../db/attachments";
import { copyAttachment, openAttachment } from "../desktop/files";
import { failureText } from "../desktop/backup";
import { formatBytes } from "../lib/attachments";
import { useApp } from "../state/AppState";

export function TaskFiles({ taskId }: { taskId: string }) {
  const app = useApp();
  const [rows, setRows] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    attachmentsForTask(taskId)
      .then((next) => {
        if (!cancel) setRows(next);
      })
      .catch(() => {
        if (!cancel) setError("Not saved");
      });
    return () => {
      cancel = true;
    };
  }, [taskId, app.revision]);

  async function addFile() {
    const picked = await open({ title: "Add file", multiple: false, directory: false });
    if (typeof picked !== "string") return;
    setBusy(true);
    setError(null);
    const id = crypto.randomUUID();
    try {
      const byteSize = await copyAttachment(picked, id);
      const result = await addAttachment(taskId, picked, byteSize, id);
      if (result.status !== "saved") {
        setError(result.status === "error" ? result.message : "Not saved");
        return;
      }
      app.bump();
    } catch (err) {
      setError(failureText(err, "That file could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 pb-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2">
          <FileText size={14} strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{row.fileName}</span>
          {row.missing ? <span className="meta text-danger shrink-0">File missing</span> : <span className="meta nums shrink-0">{formatBytes(row.byteSize)}</span>}
          <Button
            small
            disabled={row.missing}
            onClick={() => {
              void openAttachment(row.id).catch((err) => setError(failureText(err, "File missing")));
            }}
          >
            Open
          </Button>
          <Button
            small
            variant="danger"
            aria-label={`Remove ${row.fileName}`}
            onClick={() => {
              void removeAttachment(row.id).then((result) => {
                if (result.status === "saved") app.bump();
                else setError("Not saved");
              });
            }}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button small disabled={busy} onClick={() => void addFile()}>
          Add file
        </Button>
      </div>
      {error ? <p className="meta text-danger">{error}</p> : null}
    </div>
  );
}
