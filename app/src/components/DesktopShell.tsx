import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "../state/AppState";

const ShortcutContext = createContext<boolean | null>(null);

export function useShortcutRegistered(): boolean | null {
  return useContext(ShortcutContext);
}

export function accelerator(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl" || lower === "control") return "CommandOrControl";
      if (lower === "shift") return "Shift";
      if (lower === "alt" || lower === "option") return "Alt";
      if (lower === "super" || lower === "meta" || lower === "cmd" || lower === "command") return "Super";
      if (lower === "space") return "Space";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}

async function revealWindow() {
  const windowHandle = getCurrentWindow();
  await windowHandle.unminimize();
  await windowHandle.show();
  await windowHandle.setFocus();
}

function focusQuickAdd() {
  window.setTimeout(() => {
    const input = document.getElementById("quick-add");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, 50);
}

export function DesktopShell({ children }: { children: ReactNode }) {
  const app = useApp();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const shortcut = app.settings.quickAddShortcut;
  const registerChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void invoke("ensure_on_screen").catch(() => undefined);
  }, []);

  useEffect(() => {
    let unlisten = () => {};
    const behavior = app.settings.closeBehavior;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (behavior === "tray") {
          event.preventDefault();
          void getCurrentWindow().hide();
        }
      })
      .then((stop) => {
        unlisten = stop;
      })
      .catch(() => undefined);
    return () => unlisten();
  }, [app.settings.closeBehavior]);

  useEffect(() => {
    let cancel = false;
    const combo = accelerator(shortcut);
    const run = registerChain.current
      .then(async () => {
        await unregisterAll();
        if (cancel) return;
        if (!combo) throw new Error("empty shortcut");
        await register(combo, (event) => {
          if (event.state !== "Pressed") return;
          void revealWindow().then(focusQuickAdd);
        });
        if (!cancel) setRegistered(true);
      })
      .catch(() => {
        if (!cancel) setRegistered(false);
      });
    registerChain.current = run;
    return () => {
      cancel = true;
    };
  }, [shortcut]);

  useEffect(() => {
    let stop = () => {};
    let cancel = false;
    void listen("quick-add", () => {
      void revealWindow().then(focusQuickAdd);
    })
      .then((unlisten) => {
        if (cancel) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
      stop();
    };
  }, []);

  return <ShortcutContext.Provider value={registered}>{children}</ShortcutContext.Provider>;
}
