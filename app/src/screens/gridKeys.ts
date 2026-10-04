import { useEffect, useRef } from "react";

function isField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("button, a, [role='checkbox']"));
}

export function useGridKeys(handlers: {
  layers: number;
  onArrow: (delta: number) => void;
  onEnter: () => void;
}) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const current = ref.current;
      if (current.layers > 0) return;
      if (isField(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      const delta =
        key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : key === "ArrowUp" ? -7 : key === "ArrowDown" ? 7 : null;
      if (delta === null && key !== "Enter") return;
      if (key === "Enter" && isControl(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (delta === null) current.onEnter();
      else current.onArrow(delta);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
