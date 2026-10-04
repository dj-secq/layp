import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { sweepStoredFiles } from "../db/attachments";
import { loadLists, loadSections } from "../db/lists";
import { saveSetting } from "../db/settings";
import type { Section, Settings, TaskList } from "../db/types";
import { addDays, todayIso } from "../lib/dates";

export type NotificationPermission = "unknown" | "granted" | "denied";

export type Route =
  | { screen: "today"; date: string }
  | { screen: "list"; listId: string }
  | { screen: "settings" }
  | { screen: "upcoming" }
  | { screen: "calendar" }
  | { screen: "month"; year: number; month: number }
  | { screen: "year"; year: number }
  | { screen: "trackers" }
  | { screen: "hobbies" }
  | { screen: "search" }
  | { screen: "board" }
  | { screen: "matrix" }
  | { screen: "timeline" }
  | { screen: "focus" }
  | { screen: "stats" }
  | { screen: "trash" }
  | { screen: "filter"; filterId: string };

type ScreenActions = {
  taskIds: string[];
  toggleTask: (id: string) => void;
};

type AppValue = {
  settings: Settings;
  lists: TaskList[];
  sections: Section[];
  route: Route;
  sidebarOpen: boolean;
  openTaskId: string | null;
  cursorId: string | null;
  revision: number;
  civilToday: string;
  dbPath: string;
  helpOpen: boolean;
  layers: number;
  notificationPermission: NotificationPermission;
  goToday: (date?: string) => void;
  goList: (listId: string) => void;
  goSettings: () => void;
  goMonth: (year: number, month: number) => void;
  goYear: (year: number) => void;
  goTrackers: () => void;
  goHobbies: () => void;
  goUpcoming: () => void;
  goCalendar: () => void;
  goSearch: () => void;
  goBoard: () => void;
  goMatrix: () => void;
  goTimeline: () => void;
  goFocus: () => void;
  goStats: () => void;
  goTrash: () => void;
  goFilter: (filterId: string) => void;
  boardListId: string | null;
  setBoardListId: (id: string | null) => void;
  toggleSidebar: () => void;
  setOpenTaskId: (id: string | null) => void;
  setCursorId: (id: string | null) => void;
  setHelpOpen: (open: boolean) => void;
  bump: () => void;
  refreshLists: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  pushLayer: () => void;
  popLayer: () => void;
  bindScreen: (actions: ScreenActions) => void;
  setNotificationPermission: (next: NotificationPermission) => void;
};

const Context = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(Context);
  if (!value) throw new Error("useApp outside provider");
  return value;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("button, a, [role='checkbox']"));
}

export function AppProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial: { settings: Settings; lists: TaskList[]; sections: Section[]; dbPath: string };
}) {
  const [settings, setSettings] = useState(initial.settings);
  const [lists, setLists] = useState(initial.lists);
  const [sections, setSections] = useState(initial.sections);
  const [civilToday, setCivilToday] = useState(todayIso);
  const [route, setRoute] = useState<Route>({ screen: "today", date: civilToday });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [layers, setLayers] = useState(0);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("unknown");
  const [boardListId, setBoardListId] = useState<string | null>(null);
  const screen = useRef<ScreenActions>({ taskIds: [], toggleTask() {} });
  const routeRef = useRef(route);
  const cursorRef = useRef(cursorId);
  const todayRef = useRef(civilToday);
  const layersRef = useRef(0);
  const openTaskRef = useRef(openTaskId);
  routeRef.current = route;
  cursorRef.current = cursorId;
  todayRef.current = civilToday;
  layersRef.current = layers;
  openTaskRef.current = openTaskId;

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    void sweepStoredFiles().catch(() => undefined);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const next = todayIso();
      setCivilToday((current) => {
        if (current !== next) {
          setRoute((routeNow) =>
            routeNow.screen === "today" && routeNow.date === current ? { screen: "today", date: next } : routeNow,
          );
        }
        return next;
      });
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (layersRef.current > 0) return;
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (openTaskRef.current) {
          event.preventDefault();
          setOpenTaskId(null);
        }
        return;
      }
      if (layersRef.current > 0) return;
      if ((event.ctrlKey || event.metaKey) && event.code === "Comma") {
        event.preventDefault();
        setRoute({ screen: "settings" });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setRoute({ screen: "search" });
        window.setTimeout(() => document.getElementById("search")?.focus(), 0);
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.key === "q") {
        event.preventDefault();
        const input = document.getElementById("quick-add");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
        return;
      }
      if (event.key === "c") {
        event.preventDefault();
        const input = document.getElementById("inline-add");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
        return;
      }
      if (event.key === "t") {
        event.preventDefault();
        setRoute({ screen: "today", date: todayRef.current });
        return;
      }
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        routeRef.current.screen === "today" &&
        !isControl(event.target)
      ) {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        setRoute({ screen: "today", date: addDays(routeRef.current.date, delta) });
        return;
      }
      if (isControl(event.target)) return;
      if (event.key === "j" || event.key === "ArrowDown" || event.key === "k" || event.key === "ArrowUp") {
        const ids = screen.current.taskIds;
        if (ids.length === 0) return;
        event.preventDefault();
        const delta = event.key === "j" || event.key === "ArrowDown" ? 1 : -1;
        const index = ids.indexOf(cursorRef.current ?? "");
        const start = index === -1 ? (delta > 0 ? -1 : ids.length) : index;
        const next = ids[Math.max(0, Math.min(ids.length - 1, start + delta))];
        if (!next) return;
        setCursorId(next);
        document.querySelector(`[data-task-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "Enter" && cursorRef.current) {
        event.preventDefault();
        setOpenTaskId(cursorRef.current);
        return;
      }
      if (event.key === " " && cursorRef.current) {
        event.preventDefault();
        screen.current.toggleTask(cursorRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  const value = useMemo<AppValue>(
    () => ({
      settings,
      lists,
      sections,
      route,
      sidebarOpen,
      openTaskId,
      cursorId,
      revision,
      civilToday,
      dbPath: initial.dbPath,
      helpOpen,
      layers,
      notificationPermission,
      goToday(date) {
        setRoute({ screen: "today", date: date ?? todayIso() });
      },
      goList(listId) {
        setRoute({ screen: "list", listId });
        setOpenTaskId(null);
      },
      goSettings() {
        setRoute({ screen: "settings" });
        setOpenTaskId(null);
      },
      goMonth(year, month) {
        setRoute({ screen: "month", year, month });
        setOpenTaskId(null);
      },
      goYear(year) {
        setRoute({ screen: "year", year });
        setOpenTaskId(null);
      },
      goTrackers() {
        setRoute({ screen: "trackers" });
        setOpenTaskId(null);
      },
      goHobbies() {
        setRoute({ screen: "hobbies" });
        setOpenTaskId(null);
      },
      goUpcoming() {
        setRoute({ screen: "upcoming" });
        setOpenTaskId(null);
      },
      goCalendar() {
        setRoute({ screen: "calendar" });
        setOpenTaskId(null);
      },
      goSearch() {
        setRoute({ screen: "search" });
      },
      goBoard() {
        setRoute({ screen: "board" });
        setOpenTaskId(null);
      },
      goMatrix() {
        setRoute({ screen: "matrix" });
        setOpenTaskId(null);
      },
      goTimeline() {
        setRoute({ screen: "timeline" });
        setOpenTaskId(null);
      },
      goFocus() {
        setRoute({ screen: "focus" });
        setOpenTaskId(null);
      },
      goStats() {
        setRoute({ screen: "stats" });
        setOpenTaskId(null);
      },
      goTrash() {
        setRoute({ screen: "trash" });
        setOpenTaskId(null);
      },
      goFilter(filterId) {
        setRoute({ screen: "filter", filterId });
        setOpenTaskId(null);
      },
      boardListId,
      setBoardListId,
      toggleSidebar() {
        setSidebarOpen((open) => !open);
      },
      setOpenTaskId(id) {
        setOpenTaskId(id);
        if (id) setCursorId(id);
      },
      setCursorId,
      setHelpOpen,
      bump() {
        setRevision((count) => count + 1);
      },
      async refreshLists() {
        const [nextLists, nextSections] = await Promise.all([loadLists(), loadSections()]);
        setLists(nextLists);
        setSections(nextSections);
      },
      async updateSettings(patch) {
        const previous = settings;
        setSettings({ ...settings, ...patch });
        try {
          if (patch.theme) await saveSetting("theme", patch.theme);
          if (patch.weekStart) await saveSetting("weekStart", patch.weekStart);
          if (patch.clock) await saveSetting("clock", patch.clock);
          if (patch.pomoWorkMinutes !== undefined) await saveSetting("pomoWorkMinutes", String(patch.pomoWorkMinutes));
          if (patch.pomoBreakMinutes !== undefined) await saveSetting("pomoBreakMinutes", String(patch.pomoBreakMinutes));
          if (patch.pomoSoundWork !== undefined) await saveSetting("pomoSoundWork", patch.pomoSoundWork);
          if (patch.pomoSoundBreak !== undefined) await saveSetting("pomoSoundBreak", patch.pomoSoundBreak);
          if (patch.closeBehavior) await saveSetting("closeBehavior", patch.closeBehavior);
          if (patch.quickAddShortcut !== undefined) await saveSetting("quickAddShortcut", patch.quickAddShortcut);
        } catch (err) {
          setSettings(previous);
          throw err;
        }
      },
      pushLayer() {
        setLayers((count) => count + 1);
      },
      popLayer() {
        setLayers((count) => Math.max(0, count - 1));
      },
      bindScreen(actions) {
        screen.current = actions;
      },
      setNotificationPermission(next) {
        setNotificationPermission((current) => (current === next ? current : next));
      },
    }),
    [settings, lists, sections, route, sidebarOpen, openTaskId, cursorId, revision, civilToday, helpOpen, layers, notificationPermission, boardListId, initial.dbPath],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
