import { createContext, createElement, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function motionMs(): number {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return 180;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
}

/** Keep a subtree mounted long enough for its close transition. `shown` is false on the first open frame so the transition can run. */
export function usePresence(open: boolean): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    if (!open) {
      setShown(false);
      if (motionMs() === 0) {
        setMounted(false);
        return;
      }
      const id = window.setTimeout(() => setMounted(false), motionMs());
      return () => window.clearTimeout(id);
    }
    if (motionMs() === 0) {
      setShown(true);
      return;
    }
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setShown(true));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [open]);

  return { mounted: mounted || open, shown: open && shown };
}

const ShownContext = createContext<boolean | null>(null);

/** Hold the last children through the exit so a parent can clear its flag immediately. */
export function Presence({ open, children }: { open: boolean; children: ReactNode }) {
  const presence = usePresence(open);
  const held = useRef(children);
  if (open) held.current = children;
  if (!presence.mounted) return null;
  return createElement(ShownContext.Provider, { value: presence.shown }, open ? children : held.current);
}

/** Open pose. Outside Presence this stays true so a dialog that is not wrapped still appears. */
export function useShown(): boolean {
  const value = useContext(ShownContext);
  return value === null ? true : value;
}
