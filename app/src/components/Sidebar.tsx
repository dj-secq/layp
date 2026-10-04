import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Columns3,
  Ellipsis,
  FolderPlus,
  GanttChart,
  Grid3x3,
  Inbox,
  LayoutGrid,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings,
  Sun,
  Timer,
} from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { createCountdown, deleteCountdown, loadCountdowns, type Countdown } from "../db/countdowns";
import { createFilter, loadFilters, type SavedFilter } from "../db/filters";
import {
  archiveList,
  assignFolder,
  createFolder,
  createList,
  createSection,
  firstSectionId,
  loadFolders,
  recolorList,
  renameList,
  reorderFolders,
  reorderLists,
  type Folder,
} from "../db/lists";
import { loadTags, type Tag } from "../db/tags";
import { createTask } from "../db/tasks";
import type { Priority } from "../db/types";
import { parseQuickAdd } from "../lib/parse";
import { countdownLabel, emptyRule, movedIds, type FilterRule } from "../lib/planner";
import { DEFAULT_LIST_COLOR, STICKERS, stickerName } from "../lib/stickers";
import { useApp } from "../state/AppState";
import { Button } from "./Button";
import { Choice } from "./Choice";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { MarkGlyph } from "./Mark";

type Dest =
  | "today"
  | "inbox"
  | "upcoming"
  | "calendar"
  | "board"
  | "matrix"
  | "timeline"
  | "month"
  | "year"
  | "trackers"
  | "hobbies"
  | "focus"
  | "stats"
  | "settings";

const moreScreens = new Set(["board", "matrix", "timeline", "month", "year", "trackers", "hobbies", "focus", "stats"]);

function NavIcon({ name }: { name: Dest }) {
  const props = { size: 16, strokeWidth: 1.75, "aria-hidden": true as const };
  switch (name) {
    case "today":
      return <Sun {...props} />;
    case "inbox":
      return <Inbox {...props} />;
    case "upcoming":
      return <CalendarClock {...props} />;
    case "calendar":
      return <Calendar {...props} />;
    case "board":
      return <Columns3 {...props} />;
    case "matrix":
      return <LayoutGrid {...props} />;
    case "timeline":
      return <GanttChart {...props} />;
    case "month":
      return <CalendarRange {...props} />;
    case "year":
      return <CalendarDays {...props} />;
    case "trackers":
      return <Grid3x3 {...props} />;
    case "hobbies":
      return <Palette {...props} />;
    case "focus":
      return <Timer {...props} />;
    case "stats":
      return <BarChart3 {...props} />;
    case "settings":
      return <Settings {...props} />;
  }
}

function Destination({
  icon,
  label,
  current,
  iconOnly = false,
  onClick,
}: {
  icon: Dest;
  label: string;
  current: boolean;
  iconOnly?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="nav-row"
      aria-current={current ? "page" : undefined}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={onClick}
    >
      <NavIcon name={icon} />
      {iconOnly ? null : <span className="truncate">{label}</span>}
    </button>
  );
}

function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <button type="button" className="nav-row" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={16} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.75} aria-hidden />}
        <span className="truncate">{label}</span>
      </button>
      {open ? <div className="disclose-panel grid gap-1 pl-2">{children}</div> : null}
    </div>
  );
}

export function Sidebar({ rail, narrow }: { rail: boolean; narrow: boolean }) {
  const app = useApp();
  const [quick, setQuick] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickHelp, setQuickHelp] = useState(false);
  const quickRef = useRef<HTMLFormElement>(null);
  const [creating, setCreating] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [countdowns, setCountdowns] = useState<Countdown[]>([]);
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [makingFilter, setMakingFilter] = useState(false);
  const [makingFolder, setMakingFolder] = useState(false);
  const [makingCountdown, setMakingCountdown] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() => moreScreens.has(app.route.screen));
  const [countdownsOpen, setCountdownsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});
  const drawerRef = useRef<HTMLElement>(null);
  const inbox = app.lists.find((list) => list.isInbox);
  const lists = app.lists.filter((list) => !list.isInbox);

  useEffect(() => {
    let cancel = false;
    Promise.all([loadFolders(), loadCountdowns(), loadFilters()])
      .then(([nextFolders, nextCountdowns, nextFilters]) => {
        if (cancel) return;
        setFolders(nextFolders);
        setCountdowns(nextCountdowns);
        setFilters(nextFilters);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [app.revision]);

  useEffect(() => {
    if (moreScreens.has(app.route.screen)) setMoreOpen(true);
  }, [app.route.screen]);

  useEffect(() => {
    if (!rail) setDrawer(false);
  }, [rail]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (app.layers > 0) return;
      if (!((event.ctrlKey || event.metaKey) && event.code === "Backslash")) return;
      event.preventDefault();
      if (narrow) setDrawer((open) => !open);
      else app.toggleSidebar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, narrow]);

  useEffect(() => {
    if (!drawer) return;
    drawerRef.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [drawer]);

  useEffect(() => {
    if (!quickHelp) return;
    function onPointer(event: Event) {
      if (!quickRef.current?.contains(event.target as Node)) setQuickHelp(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setQuickHelp(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [quickHelp]);

  async function addQuick() {
    const now = Temporal.Now.plainDateTimeISO();
    const parsed = parseQuickAdd(
      quick,
      app.lists.map((list) => ({ id: list.id, name: list.name })),
      { today: now.toPlainDate().toString(), minutes: now.hour * 60 + now.minute },
    );
    if (parsed.status === "empty") return;
    if (parsed.status === "reject") {
      setQuickError("Add a title.");
      return;
    }
    const listId = parsed.listId ?? inbox?.id;
    if (!listId) {
      setQuickError("Not saved");
      return;
    }
    const result = await createTask({
      title: parsed.title,
      listId,
      sectionId: firstSectionId(app.sections, listId),
      dueOn: parsed.dueOn,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      important: parsed.important,
      recurrence: parsed.recurrence,
    });
    if (result.status === "saved") {
      setQuick("");
      setQuickError(parsed.notice);
      app.bump();
      return;
    }
    setQuickError(result.status === "error" ? result.message : "Not saved");
  }

  async function moveFolder(id: string, direction: -1 | 1) {
    const next = movedIds(
      folders.map((folder) => folder.id),
      id,
      direction,
    );
    if (!next) return;
    await reorderFolders(next);
    app.bump();
  }

  function leave(run: () => void) {
    run();
    setDrawer(false);
  }

  function openMonth() {
    const today = Temporal.PlainDate.from(app.civilToday);
    leave(() => app.goMonth(today.year, today.month));
  }

  const inDrawer = narrow || !app.sidebarOpen;

  function collapse() {
    if (inDrawer) setDrawer(false);
    else app.toggleSidebar();
  }

  const full = (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="nav-row nav-icon"
          aria-label={inDrawer ? "Close menu" : "Collapse sidebar"}
          title={inDrawer ? "Close menu" : "Collapse sidebar"}
          onClick={collapse}
        >
          <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className="mark" onClick={() => leave(() => app.goToday())}>
          <MarkGlyph />
          <span>Layp</span>
        </button>
      </div>
      <form
        ref={quickRef}
        onSubmit={(event) => {
          event.preventDefault();
          void addQuick();
        }}
      >
        <div className="quick-add">
          <label className="sr-only" htmlFor="quick-add">
            Quick add
          </label>
          <input
            id="quick-add"
            className="quick-add-input"
            placeholder="call mom tomorrow 9am"
            value={quick}
            maxLength={500}
            onChange={(event) => {
              setQuick(event.target.value);
              setQuickError(null);
            }}
          />
          <button
            type="button"
            className="quick-help"
            aria-expanded={quickHelp}
            aria-controls="quick-add-format"
            aria-label="Quick add format"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setQuickHelp((open) => !open);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setQuickHelp((open) => !open);
            }}
          >
            <CircleHelp size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        {quickHelp ? (
          <div className="quick-help-panel" id="quick-add-format">
            <p className="quick-help-lead">Name the task, then any of these. Enter adds it.</p>
            <dl className="quick-help-list">
              <div>
                <dt>Day</dt>
                <dd className="quick-help-bits">
                  <span>today</span>
                  <span>tomorrow</span>
                  <span>tonight (9pm)</span>
                  <span>friday</span>
                  <span>next friday</span>
                  <span>oct 20</span>
                </dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd className="quick-help-bits">
                  <span>9am</span>
                  <span>2:30pm</span>
                  <span>14:00</span>
                </dd>
              </div>
              <div>
                <dt>Repeat</dt>
                <dd className="quick-help-bits">
                  <span>every day</span>
                  <span>every weekday</span>
                  <span>every friday</span>
                  <span>every month on the 15th</span>
                </dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd className="quick-help-bits">
                  <span>p1 for high</span>
                  <span>p2 for medium</span>
                  <span>p3 for low</span>
                </dd>
              </div>
              <div>
                <dt>List</dt>
                <dd className="quick-help-bits">
                  <span>in School, if that list exists</span>
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
        {quickError ? (
          <p role="status" className="meta mt-1 text-danger">
            {quickError}
          </p>
        ) : null}
      </form>

      <div className="grid gap-1">
        <Destination icon="today" label="Today" current={app.route.screen === "today"} onClick={() => leave(() => app.goToday())} />
        {inbox ? (
          <Destination
            icon="inbox"
            label="Inbox"
            current={app.route.screen === "list" && app.route.listId === inbox.id}
            onClick={() => leave(() => app.goList(inbox.id))}
          />
        ) : null}
        <Destination icon="upcoming" label="Upcoming" current={app.route.screen === "upcoming"} onClick={() => leave(() => app.goUpcoming())} />
        <Destination icon="calendar" label="Calendar" current={app.route.screen === "calendar"} onClick={() => leave(() => app.goCalendar())} />
      </div>

      <div className="grid gap-1">
        <p className="section-label">Lists</p>
        {lists
          .filter((list) => !list.folderId)
          .map((list) => (
            <ListLink key={list.id} id={list.id} folders={folders} onOpen={() => setDrawer(false)} />
          ))}
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          New list
        </Button>
        <Button variant="secondary" onClick={() => setMakingFolder(true)}>
          <FolderPlus size={16} strokeWidth={1.75} aria-hidden />
          New folder
        </Button>
        {folders.map((folder) => {
          const inFolder = app.lists.filter((list) => list.folderId === folder.id && !list.isInbox);
          const open = folder.id in folderOpen ? folderOpen[folder.id] : inFolder.length <= 3;
          return (
            <div key={folder.id} className="grid gap-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="nav-row min-w-0 flex-1"
                  aria-expanded={open}
                  onClick={() => setFolderOpen((current) => ({ ...current, [folder.id]: !open }))}
                >
                  {open ? <ChevronDown size={16} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.75} aria-hidden />}
                  <span className="truncate">{folder.name}</span>
                </button>
                <Button small aria-label={`Move ${folder.name} up`} onClick={() => void moveFolder(folder.id, -1)}>
                  Up
                </Button>
                <Button small aria-label={`Move ${folder.name} down`} onClick={() => void moveFolder(folder.id, 1)}>
                  Down
                </Button>
              </div>
              {open
                ? inFolder.map((list) => <ListLink key={list.id} id={list.id} folders={folders} onOpen={() => setDrawer(false)} />)
                : null}
            </div>
          );
        })}
      </div>

      <Disclosure label="More" open={moreOpen} onToggle={() => setMoreOpen((open) => !open)}>
        <Destination icon="board" label="Board" current={app.route.screen === "board"} onClick={() => leave(() => app.goBoard())} />
        <Destination icon="matrix" label="Matrix" current={app.route.screen === "matrix"} onClick={() => leave(() => app.goMatrix())} />
        <Destination icon="timeline" label="Timeline" current={app.route.screen === "timeline"} onClick={() => leave(() => app.goTimeline())} />
        <Destination icon="month" label="Month" current={app.route.screen === "month"} onClick={openMonth} />
        <Destination
          icon="year"
          label="Year"
          current={app.route.screen === "year"}
          onClick={() => leave(() => app.goYear(Temporal.PlainDate.from(app.civilToday).year))}
        />
        <Destination icon="trackers" label="Trackers" current={app.route.screen === "trackers"} onClick={() => leave(() => app.goTrackers())} />
        <Destination icon="hobbies" label="Hobbies" current={app.route.screen === "hobbies"} onClick={() => leave(() => app.goHobbies())} />
        <Destination icon="focus" label="Focus" current={app.route.screen === "focus"} onClick={() => leave(() => app.goFocus())} />
        <Destination icon="stats" label="Stats" current={app.route.screen === "stats"} onClick={() => leave(() => app.goStats())} />
      </Disclosure>

      <Disclosure label={`Countdowns ${countdowns.length}`} open={countdownsOpen} onToggle={() => setCountdownsOpen((open) => !open)}>
        {countdowns.length === 0 ? <p className="meta px-2">No countdowns.</p> : null}
        {countdowns.map((countdown) => (
          <div key={countdown.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate">
              {countdown.title} · {countdownLabel(countdown.targetOn, app.civilToday)}
            </span>
            <Button
              small
              aria-label={`Remove ${countdown.title}`}
              onClick={() => {
                void deleteCountdown(countdown.id)
                  .then(() => app.bump())
                  .catch(() => undefined);
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => {
            setCountdownsOpen(true);
            setMakingCountdown(true);
          }}
        >
          Add countdown
        </Button>
      </Disclosure>

      <Disclosure label={`Filters ${filters.length}`} open={filtersOpen} onToggle={() => setFiltersOpen((open) => !open)}>
        {filters.length === 0 ? <p className="meta px-2">No saved filters.</p> : null}
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className="nav-row"
            aria-current={app.route.screen === "filter" && app.route.filterId === filter.id ? "page" : undefined}
            onClick={() => leave(() => app.goFilter(filter.id))}
          >
            {filter.name}
          </button>
        ))}
        <Button
          variant="secondary"
          onClick={() => {
            setFiltersOpen(true);
            setMakingFilter(true);
          }}
        >
          New filter
        </Button>
      </Disclosure>

    </>
  );

  const foot = (
    <Destination icon="settings" label="Settings" current={app.route.screen === "settings"} onClick={() => leave(() => app.goSettings())} />
  );

  const railNav = (
    <>
      <button
        type="button"
        className="nav-row"
        aria-label={narrow ? "Open sidebar" : "Expand sidebar"}
        title={narrow ? "Open sidebar" : "Expand sidebar"}
        onClick={() => (narrow ? setDrawer(true) : app.toggleSidebar())}
      >
        <PanelLeft size={16} strokeWidth={1.75} aria-hidden />
      </button>
      <button type="button" className="mark" aria-label="Layp, Today" title="Layp" onClick={() => app.goToday()}>
        <MarkGlyph />
      </button>
      <Destination icon="today" iconOnly label="Today" current={app.route.screen === "today"} onClick={() => app.goToday()} />
      {inbox ? (
        <Destination
          icon="inbox"
          iconOnly
          label="Inbox"
          current={app.route.screen === "list" && app.route.listId === inbox.id}
          onClick={() => app.goList(inbox.id)}
        />
      ) : null}
      <Destination icon="upcoming" iconOnly label="Upcoming" current={app.route.screen === "upcoming"} onClick={() => app.goUpcoming()} />
      <Destination icon="calendar" iconOnly label="Calendar" current={app.route.screen === "calendar"} onClick={() => app.goCalendar()} />
      <button type="button" className="nav-row" aria-label="More" title="More" onClick={() => setDrawer(true)}>
        <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
      </button>
      <div className="mt-auto grid gap-1">
        <Destination icon="settings" iconOnly label="Settings" current={app.route.screen === "settings"} onClick={() => app.goSettings()} />
      </div>
    </>
  );

  return (
    <>
      <aside className="sidebar" data-compact={rail ? "true" : undefined} aria-label="Sidebar">
        {rail ? (
          railNav
        ) : (
          <>
            <div className="sidebar-scroll">{full}</div>
            {foot}
          </>
        )}
      </aside>
      {rail && drawer ? (
        <>
          <button type="button" className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setDrawer(false)} />
          <aside ref={drawerRef} className="sidebar sidebar-drawer" aria-label="Sidebar">
            <div className="sidebar-scroll">{full}</div>
            {foot}
          </aside>
        </>
      ) : null}
      {creating ? <NewListDialog onClose={() => setCreating(false)} /> : null}
      {makingFolder ? <FolderDialog onClose={() => setMakingFolder(false)} /> : null}
      {makingCountdown ? <CountdownDialog onClose={() => setMakingCountdown(false)} /> : null}
      {makingFilter ? <FilterDialog onClose={() => setMakingFilter(false)} /> : null}
    </>
  );
}

function ListLink({ id, folders, onOpen }: { id: string; folders: Folder[]; onOpen?: () => void }) {
  const app = useApp();
  const list = app.lists.find((item) => item.id === id);
  const [menu, setMenu] = useState(false);
  if (!list) return null;
  const current = app.route.screen === "list" && app.route.listId === list.id;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="nav-row min-w-0 flex-1"
        aria-current={current ? "page" : undefined}
        onClick={() => {
          app.goList(list.id);
          onOpen?.();
        }}
      >
        <span className="priority-mark" style={{ background: list.color }} aria-hidden />
        <span className="truncate">{list.name}</span>
      </button>
      <Button small aria-label={`Menu for ${list.name}`} onClick={() => setMenu(true)}>
        Menu
      </Button>
      {menu ? <ListMenu listId={list.id} folders={folders} onClose={() => setMenu(false)} /> : null}
    </div>
  );
}

function ListMenu({ listId, folders, onClose }: { listId: string; folders: Folder[]; onClose: () => void }) {
  const app = useApp();
  const list = app.lists.find((item) => item.id === listId);
  const [name, setName] = useState(list?.name ?? "");
  const [sectionName, setSectionName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!list) return null;

  const siblings = app.lists.filter((item) => !item.isInbox && item.folderId === list.folderId).map((item) => item.id);

  async function rename() {
    if (!list) return;
    const result = await renameList(list, name);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setError(null);
    await app.refreshLists();
  }

  async function paint(hex: string) {
    const current = app.lists.find((item) => item.id === listId);
    if (!current) return;
    const result = await recolorList(current, hex);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setError(null);
    await app.refreshLists();
  }

  async function place(folderId: string | null) {
    const current = app.lists.find((item) => item.id === listId);
    if (!current) return;
    const result = await assignFolder(current, folderId);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setError(null);
    await app.refreshLists();
  }

  async function move(direction: -1 | 1) {
    const next = movedIds(siblings, listId, direction);
    if (!next) return;
    const siblingSet = new Set(siblings);
    const ordered: string[] = [];
    let placed = false;
    for (const item of app.lists) {
      if (siblingSet.has(item.id)) {
        if (!placed) {
          ordered.push(...next);
          placed = true;
        }
      } else {
        ordered.push(item.id);
      }
    }
    await reorderLists(ordered);
    await app.refreshLists();
  }

  async function addSection() {
    const result = await createSection(listId, sectionName);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setSectionName("");
    setError(null);
    await app.refreshLists();
    app.bump();
  }

  async function archive() {
    const current = app.lists.find((item) => item.id === listId);
    if (!current) return;
    const result = await archiveList(current);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    await app.refreshLists();
    if (app.route.screen === "list" && app.route.listId === listId) app.goToday();
    app.bump();
    onClose();
  }

  return (
    <Dialog title={list.name} onClose={onClose}>
      <div className="grid gap-3">
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void rename();
          }}
        >
          <Field label="Name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <Button variant="primary" type="submit">
            Rename
          </Button>
        </form>
        <ColorPicker color={list.color} onChange={(hex) => void paint(hex)} />
        <Choice
          stack
          label="Folder"
          value={list.folderId ?? ""}
          options={[{ value: "", label: "No folder" }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
          onChange={(folderId) => void place(folderId || null)}
        />
        <div className="flex gap-2">
          <Button onClick={() => void move(-1)}>Move up</Button>
          <Button onClick={() => void move(1)}>Move down</Button>
        </div>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void addSection();
          }}
        >
          <Field label="New section" value={sectionName} maxLength={80} onChange={(event) => setSectionName(event.target.value)} />
          <Button type="submit">Add section</Button>
        </form>
        {error ? <p className="meta text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => void archive()}>
            Archive list
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function FolderDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const result = await createFolder(name);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setName("");
    setError(null);
    app.bump();
    onClose();
  }

  return (
    <Dialog title="New folder" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label="Name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        {error ? <p className="meta text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="primary" type="submit">
            Add folder
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CountdownDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(app.civilToday);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const result = await createCountdown(title, date);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    setTitle("");
    setError(null);
    app.bump();
    onClose();
  }

  return (
    <Dialog title="Add countdown" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Field label="Countdown" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
        <Field label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        {error ? <p className="meta text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="primary" type="submit">
            Add countdown
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function FilterDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [rule, setRule] = useState<FilterRule>(emptyRule);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    loadTags()
      .then((rows) => {
        if (!cancel) setTags(rows);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  async function save() {
    const result = await createFilter(name, rule);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    app.bump();
    app.goFilter(result.row.id);
    onClose();
  }

  return (
    <Dialog title="New filter" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        <Choice
          stack
          label="List"
          value={rule.listId ?? ""}
          options={[{ value: "", label: "Any list" }, ...app.lists.map((list) => ({ value: list.id, label: list.name }))]}
          onChange={(listId) => setRule({ ...rule, listId: listId || null })}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rule.listNot}
            disabled={!rule.listId}
            onChange={(event) => setRule({ ...rule, listNot: event.target.checked })}
          />
          <span>Is not this list</span>
        </label>
        <Choice
          stack
          label="Tag"
          value={rule.tagId ?? ""}
          options={[{ value: "", label: "Any tag" }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
          onChange={(tagId) => setRule({ ...rule, tagId: tagId || null })}
        />
        <Choice
          stack
          label="Priority"
          value={rule.priority ?? ""}
          options={[
            { value: "", label: "Any priority" },
            { value: "high", label: "High" },
            { value: "medium", label: "Medium" },
            { value: "low", label: "Low" },
            { value: "none", label: "None" },
          ]}
          onChange={(priority) => setRule({ ...rule, priority: priority ? (priority as Priority) : null })}
        />
        <Choice
          stack
          label="Due"
          value={rule.due}
          options={[
            { value: "any", label: "Any date" },
            { value: "overdue", label: "Overdue" },
            { value: "today", label: "Today" },
            { value: "next7", label: "Next 7 days" },
            { value: "none", label: "No date" },
            { value: "range", label: "Date range" },
          ]}
          onChange={(due) => setRule({ ...rule, due: due as FilterRule["due"] })}
        />
        {rule.due === "range" ? (
          <div className="grid gap-2">
            <Field
              label="From"
              type="date"
              value={rule.dueFrom ?? ""}
              onChange={(event) => setRule({ ...rule, dueFrom: event.target.value || null })}
            />
            <Field
              label="To"
              type="date"
              value={rule.dueTo ?? ""}
              onChange={(event) => setRule({ ...rule, dueTo: event.target.value || null })}
            />
          </div>
        ) : null}
        <Choice
          stack
          label="Completed"
          value={rule.completed}
          options={[
            { value: "open", label: "Open" },
            { value: "completed", label: "Completed" },
            { value: "any", label: "Any" },
          ]}
          onChange={(completed) => setRule({ ...rule, completed: completed as FilterRule["completed"] })}
        />
        <Choice
          stack
          label="Important"
          value={flagValue(rule.important)}
          options={[
            { value: "any", label: "Any" },
            { value: "yes", label: "Important" },
            { value: "no", label: "Not important" },
          ]}
          onChange={(value) => setRule({ ...rule, important: flagFrom(value) })}
        />
        <Choice
          stack
          label="Urgent"
          value={flagValue(rule.urgent)}
          options={[
            { value: "any", label: "Any" },
            { value: "yes", label: "Urgent" },
            { value: "no", label: "Not urgent" },
          ]}
          onChange={(value) => setRule({ ...rule, urgent: flagFrom(value) })}
        />
        {error ? <p className="meta text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="primary" type="submit">
            Save filter
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function flagValue(value: boolean | null): "any" | "yes" | "no" {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "any";
}

function flagFrom(value: string): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function NewListDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_LIST_COLOR);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const result = await createList(name, color);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    await app.refreshLists();
    app.goList(result.row.id);
    onClose();
  }

  return (
    <Dialog title="New list" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label="Name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        <ColorPicker color={color} onChange={setColor} />
        {error ? <p className="meta text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="primary" type="submit">
            Create list
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ColorPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  return (
    <div className="grid gap-1">
      <span className="meta">Color</span>
      <div className="flex flex-wrap gap-2">
        {STICKERS.map((sticker) => (
          <button
            key={sticker.hex}
            type="button"
            className="swatch press-sm"
            style={{ background: sticker.hex }}
            aria-label={stickerName(sticker.hex)}
            aria-pressed={color === sticker.hex}
            onClick={() => onChange(sticker.hex)}
          />
        ))}
      </div>
    </div>
  );
}
