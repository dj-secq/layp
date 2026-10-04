import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
  stack = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  stack?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setBox({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (root.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    place();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div className="choice" data-stack={stack ? "true" : undefined}>
      <span className="label" id={labelId}>
        {label}
      </span>
      <div className="choice-control" ref={root}>
        <button
          ref={buttonRef}
          type="button"
          className="field choice-button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={labelId}
          disabled={disabled}
          onClick={() => setOpen((shown) => !shown)}
        >
          <span className="truncate">{current?.label}</span>
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
        </button>
        {open && box
          ? createPortal(
              <div
                ref={menuRef}
                className="choice-menu"
                role="listbox"
                aria-labelledby={labelId}
                style={{ position: "fixed", top: box.top, left: box.left, width: box.width, zIndex: 70 }}
              >
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    className="choice-option"
                    aria-selected={option.value === value}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}
