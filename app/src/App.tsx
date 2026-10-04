import { useEffect, useState } from "react";
import { DesktopShell } from "./components/DesktopShell";
import { FocusProvider } from "./components/FocusTimer";
import { ReminderClock } from "./components/ReminderClock";
import { Sidebar } from "./components/Sidebar";
import { Shortcuts } from "./components/Shortcuts";
import { databaseFile, logFailure, openDatabase } from "./db/client";
import { loadLists, loadSections } from "./db/lists";
import { loadSettings } from "./db/settings";
import type { Section, Settings, TaskList } from "./db/types";
import { BoardScreen } from "./screens/BoardScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { FilterScreen } from "./screens/FilterScreen";
import { FocusScreen } from "./screens/FocusScreen";
import { HobbiesScreen } from "./screens/HobbiesScreen";
import { ListScreen } from "./screens/ListScreen";
import { MatrixScreen } from "./screens/MatrixScreen";
import { MonthScreen } from "./screens/MonthScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TimelineScreen } from "./screens/TimelineScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { TrashScreen } from "./screens/TrashScreen";
import { TrackersScreen } from "./screens/TrackersScreen";
import { UpcomingScreen } from "./screens/UpcomingScreen";
import { YearScreen } from "./screens/YearScreen";
import { AppProvider, useApp, type Route } from "./state/AppState";
import { TaskPanel } from "./task-panel/TaskPanel";
import { Button } from "./components/Button";
import { MarkGlyph } from "./components/Mark";

function routeKey(route: Route): string {
  switch (route.screen) {
    case "today":
      return `today:${route.date}`;
    case "list":
      return `list:${route.listId}`;
    case "month":
      return `month:${route.year}-${route.month}`;
    case "year":
      return `year:${route.year}`;
    case "filter":
      return `filter:${route.filterId}`;
    default:
      return route.screen;
  }
}

type Boot =
  | { status: "loading" }
  | { status: "error"; message: string; path: string | null }
  | { status: "ready"; settings: Settings; lists: TaskList[]; sections: Section[]; dbPath: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancel = false;
    loadBoot()
      .then((result) => {
        if (!cancel) setBoot(result);
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setBoot({
            status: "error",
            message: err instanceof Error ? err.message : "The database did not open.",
            path: null,
          });
        }
      });
    return () => {
      cancel = true;
    };
  }, [attempt]);

  if (boot.status === "loading") {
    return (
      <main className="grid h-full place-items-center p-6">
        <p className="mark">
          <MarkGlyph />
          <span>Layp</span>
        </p>
      </main>
    );
  }

  if (boot.status === "error") {
    return (
      <main className="grid h-full content-center gap-4 p-8">
        <p className="mark">
          <MarkGlyph />
          <span>Layp</span>
        </p>
        <h1 className="page-title">Layp could not open the database.</h1>
        <p className="max-w-xl">{boot.message}</p>
        {boot.path ? (
          <p>
            <span className="meta">Database path</span>
            <br />
            <span className="break-all">{boot.path}</span>
          </p>
        ) : null}
        <div>
          <Button variant="primary" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  return (
    <AppProvider initial={boot}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const app = useApp();
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1099px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1099px)");
    const apply = () => setNarrow(media.matches);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return (
    <FocusProvider>
    <DesktopShell>
    <div className="shell">
      <ReminderClock />
      <Sidebar rail={narrow || !app.sidebarOpen} narrow={narrow} />
      <div className="stage">
        <main className="main-pane flex-1" key={routeKey(app.route)}>
          {app.route.screen === "today" ? <TodayScreen date={app.route.date} /> : null}
          {app.route.screen === "list" ? <ListScreen listId={app.route.listId} /> : null}
          {app.route.screen === "month" ? <MonthScreen year={app.route.year} month={app.route.month} /> : null}
          {app.route.screen === "year" ? <YearScreen year={app.route.year} /> : null}
          {app.route.screen === "trackers" ? <TrackersScreen /> : null}
          {app.route.screen === "hobbies" ? <HobbiesScreen /> : null}
          {app.route.screen === "upcoming" ? <UpcomingScreen /> : null}
          {app.route.screen === "calendar" ? <CalendarScreen /> : null}
          {app.route.screen === "settings" ? <SettingsScreen /> : null}
          {app.route.screen === "search" ? <SearchScreen /> : null}
          {app.route.screen === "board" ? <BoardScreen /> : null}
          {app.route.screen === "matrix" ? <MatrixScreen /> : null}
          {app.route.screen === "timeline" ? <TimelineScreen /> : null}
          {app.route.screen === "focus" ? <FocusScreen /> : null}
          {app.route.screen === "stats" ? <StatsScreen /> : null}
          {app.route.screen === "trash" ? <TrashScreen /> : null}
          {app.route.screen === "filter" ? <FilterScreen filterId={app.route.filterId} /> : null}
        </main>
        {app.openTaskId ? <TaskPanel overlay={narrow} /> : null}
      </div>
      {app.helpOpen ? <Shortcuts onClose={() => app.setHelpOpen(false)} /> : null}
    </div>
    </DesktopShell>
    </FocusProvider>
  );
}

async function loadBoot(): Promise<Boot> {
  let path: string | null = null;
  try {
    const file = await databaseFile();
    path = file.path;
    await openDatabase();
    const [settings, lists, sections] = await Promise.all([loadSettings(), loadLists(), loadSections()]);
    return { status: "ready", settings, lists, sections, dbPath: file.path };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The database did not open.";
    await logFailure("database open failed", message);
    return { status: "error", message, path };
  }
}
