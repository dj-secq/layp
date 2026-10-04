import { useState } from "react";

export function InlineAdd({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (title: string) => Promise<string | null>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!value.trim()) return;
    const message = await onAdd(value);
    if (message) {
      setError(message);
      return;
    }
    setValue("");
    setError(null);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="grid gap-1" htmlFor="inline-add">
        <span className="sr-only">{label}</span>
        <input
          id="inline-add"
          className="field"
          placeholder="Add a task"
          value={value}
          maxLength={500}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
      </label>
      {error ? (
        <p role="status" className="meta mt-1 text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
