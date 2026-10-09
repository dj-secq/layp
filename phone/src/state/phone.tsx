import { parsePairingCode } from "@layp/shared";
import { router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { openPhoneDatabase } from "../db/open";
import { completeTask, reopenTask } from "../db/tasks";
import { PAIR_GRAMMAR, UNREACHABLE, nextIdleDelay, pairName, parseHostPort, successLabel } from "../link/protocol";
import { clearKey, loadSession, saveHost, savePair } from "../link/store";
import { abortSync, pairWithDesktop, syncInitial, syncOnce, type SyncOutcome } from "../link/sync";

export type LinkStatus = { kind: "ok"; at: string } | { kind: "down"; message: string } | null;

type PhoneValue = {
  ready: boolean;
  bootError: string | null;
  hasKey: boolean;
  status: LinkStatus;
  revision: number;
  pair: (code: string, name: string) => Promise<string | null>;
  replaceHost: (host: string, port: string) => Promise<string | null>;
  complete: (id: string) => Promise<"saved" | "none" | "error">;
  reopen: (id: string) => Promise<"saved" | "none" | "error">;
  changed: () => void;
  forget: () => Promise<void>;
};

const PhoneContext = createContext<PhoneValue | null>(null);

export function usePhone(): PhoneValue {
  const value = use(PhoneContext);
  if (!value) throw new Error("Phone is not ready");
  return value;
}

function wasSuperseded(result: SyncOutcome): boolean {
  return result.ok === false && result.superseded === true;
}

function showOutcome(result: SyncOutcome, setStatus: (status: LinkStatus) => void): void {
  if (wasSuperseded(result)) return;
  if (result.ok) setStatus({ kind: "ok", at: successLabel(result.at) });
  else setStatus({ kind: "down", message: result.status || UNREACHABLE });
}

export function PhoneProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<LinkStatus>(null);
  const [revision, setRevision] = useState(0);
  const scheduleRef = useRef<(wait: boolean) => void>(() => {});
  const hasKeyRef = useRef(false);
  const epoch = useRef(0);
  hasKeyRef.current = hasKey;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await openPhoneDatabase();
        const session = await loadSession();
        if (cancelled) return;
        setHasKey(session !== null);
      } catch {
        if (!cancelled) setBootError("database open failed");
      } finally {
        if (!cancelled) setReady(true);
        SplashScreen.hideAsync().catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = (wait: boolean) => {
      if (stopped || !hasKeyRef.current || AppState.currentState !== "active") return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const mine = ++epoch.current;
      void syncOnce(wait).then((result) => {
        if (stopped || mine !== epoch.current || !hasKeyRef.current) return;
        showOutcome(result, setStatus);
        if (wasSuperseded(result)) return;
        if (result.ok) setRevision((value) => value + 1);
        if (stopped || mine !== epoch.current || AppState.currentState !== "active" || !hasKeyRef.current) return;
        if (result.ok) loop(true);
        else timer = setTimeout(() => loop(true), nextIdleDelay(false));
      });
    };

    scheduleRef.current = loop;

    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") loop(true);
      else {
        epoch.current += 1;
        abortSync();
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    });

    if (AppState.currentState === "active") loop(true);

    return () => {
      stopped = true;
      epoch.current += 1;
      if (timer) clearTimeout(timer);
      abortSync();
      subscription.remove();
    };
  }, [hasKey]);

  const pair = useCallback(async (code: string, name: string) => {
    const parsed = parsePairingCode(code.trim());
    if (!parsed) return PAIR_GRAMMAR;
    const paired = await pairWithDesktop(parsed, pairName(name));
    if (!paired.ok) return paired.status;
    await savePair({ host: parsed.host, port: parsed.port, key: paired.key, phoneId: "phone" });
    const synced = await syncInitial();
    setHasKey(true);
    setRevision((value) => value + 1);
    showOutcome(synced, setStatus);
    return null;
  }, []);

  const replaceHost = useCallback(async (host: string, port: string) => {
    const parsed = parseHostPort(host, port);
    if (!parsed) return "Enter a dotted IPv4 address and a port.";
    await saveHost(parsed.host, parsed.port);
    scheduleRef.current(false);
    return null;
  }, []);

  const changed = useCallback(() => {
    setRevision((value) => value + 1);
    scheduleRef.current(false);
  }, []);

  const complete = useCallback(async (id: string) => {
    const result = await completeTask(id);
    changed();
    return result;
  }, [changed]);

  const reopen = useCallback(async (id: string) => {
    const result = await reopenTask(id);
    changed();
    return result;
  }, [changed]);

  const forget = useCallback(async () => {
    hasKeyRef.current = false;
    epoch.current += 1;
    abortSync();
    await clearKey();
    setHasKey(false);
    setStatus(null);
    router.replace("/");
  }, []);

  return (
    <PhoneContext.Provider value={{ ready, bootError, hasKey, status, revision, pair, replaceHost, complete, reopen, changed, forget }}>
      {children}
    </PhoneContext.Provider>
  );
}
