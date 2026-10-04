import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label className="grid gap-1" htmlFor={id}>
      <span className="label">{label}</span>
      <input id={id} className="field" {...props} />
      {hint ? <span className="meta text-danger">{hint}</span> : null}
    </label>
  );
}

export function Area({
  label,
  ...props
}: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <label className="grid gap-1" htmlFor={id}>
      <span className="label">{label}</span>
      <textarea id={id} className="area" {...props} />
    </label>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="flex items-center gap-2 font-bold" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="check"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
