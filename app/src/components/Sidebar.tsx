import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
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
import { createCountdown, deleteCountdown, loadCountdowns, updateCountdown, type Countdown } from "../db/countdowns";
import { createFilter, loadFilters, reorderFilters, updateFilter, type SavedFilter } from "../db/filters";
import {
  archiveList,
  assignFolder,
  createFolder,
  createList,
  createSection,
  deleteFolder,
  firstSectionId,
  loadFolders,
  recolorList,
  renameFolder,
  renameList,
  reorderFolders,
  reorderLists,
  type Folder,
} from "../db/lists";
import { loadTags, type Tag } from "../db/tags";
import { createTask, recentTaskTitles } from "../db/tasks";
import type { Priority } from "../db/types";
import { parseQuickAdd, previewQuickAdd, suggestQuickAdd, type QuickSuggestion } from "@layp/shared";
import { countdownLabel, emptyRule, movedIds, type FilterRule } from "@layp/shared";
import { DEFAULT_LIST_COLOR, STICKERS, stickerName } from "@layp/shared";
import { useApp } from "../state/AppState";
import { Button } from "./Button";
import { Choice } from "./Choice";
import { Collapse } from "./Collapse";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { MarkGlyph } from "./Mark";
import { Presence, usePresence } from "../lib/motion";

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
  compact = false,
  onClick,
}: {
  icon: Dest;
  label: string;
  current: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="nav-row"
      aria-current={current ? "page" : undefined}
      title={compact ? label : undefined}
      onClick={onClick}
    >
      <NavIcon name={icon} />
      <span className="nav-label">{label}</span>
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
    <div>
      <button type="button" className="nav-row" aria-expanded={open} onClick={onToggle}>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
        <span className="nav-label">{label}</span>
      </button>
      <Collapse open={open} className="collapse-gap-sm">
        <div className="grid gap-1 pl-2">{children}</div>
      </Collapse>
    </div>
  );
}

export function Sidebar({ rail, narrow }: { rail: boolean; narrow: boolean }) {
  const app = useApp();
  const [quick, setQuick] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickHelp, setQuickHelp] = useState(false);
  const [recentTitles, setRecentTitles] = useState<string[]>([]);
  const [quickFocus, setQuickFocus] = useState<"dock" | "drawer" | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestActive, setSuggestActive] = useState(0);
  const quickRef = useRef<HTMLFormElement>(null);
  const quickAnchors = useRef<{ dock: HTMLDivElement | null; drawer: HTMLDivElement | null }>({ dock: null, drawer: null });
  const [suggestBox, setSuggestBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [countdowns, setCountdowns] = useState<Countdown[]>([]);
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [makingFilter, setMakingFilter] = useState(false);
  const [editingFilter, setEditingFilter] = useState<SavedFilter | null>(null);
  const [makingFolder, setMakingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<Folder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);
  const [makingCountdown, setMakingCountdown] = useState(false);
  const [editingCountdown, setEditingCountdown] = useState<Countdown | null>(null);
  const [drawer, setDrawer] = useState(false);
  const drawerPresence = usePresence(rail && drawer);
  const [moreOpen, setMoreOpen] = useState(() => moreScreens.has(app.route.screen));
  const [countdownsOpen, setCountdownsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});
  const drawerRef = useRef<HTMLElement>(null);
  const inbox = app.lists.find((list) => list.isInbox);
  const lists = app.lists.filter((list) => !list.isInbox);

  useEffect(() => {
    let cancel = false;
    Promise.all([loadFolders(), loadCountdowns(), loadFilters(), recentTaskTitles()])
      .then(([nextFolders, nextCountdowns, nextFilters, titles]) => {
        if (cancel) return;
        setFolders(nextFolders);
        setCountdowns(nextCountdowns);
        setFilters(nextFilters);
        setRecentTitles(titles);
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

  async function moveFilter(id: string, direction: -1 | 1) {
    const next = movedIds(
      filters.map((filter) => filter.id),
      id,
      direction,
    );
    if (!next) return;
    await reorderFilters(next);
    app.bump();
  }

  useEffect(() => {
    if (!quickFocus || !suggestOpen) return;
    function place() {
      const node = quickFocus ? quickAnchors.current[quickFocus] : null;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setSuggestBox({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [quickFocus, suggestOpen, quick, rail, drawer]);

  function acceptSuggestion(row: QuickSuggestion) {
    setQuick(row.next);
    setQuickError(null);
    setSuggestOpen(true);
    setSuggestActive(0);
  }

  function leave(run: () => void) {
    run();
    setDrawer(false);
  }

  function openMonth() {
    const today = Temporal.PlainDate.from(app.civilToday);
    leave(() => app.goMonth(today.year, today.month));
  }

  function sidebarBody(surface: "dock" | "drawer") {
    const compact = surface === "dock" && rail;
    const quickId = surface === "dock" ? "quick-add" : "quick-add-drawer";
    const quickNow = Temporal.Now.plainDateTimeISO();
    const quickClock = { today: quickNow.toPlainDate().toString(), minutes: quickNow.hour * 60 + quickNow.minute };
    const quickLists = app.lists.map((list) => ({ id: list.id, name: list.name }));
    const suggestions = suggestQuickAdd(
      quick,
      { lists: quickLists, recentTitles, snippets: app.settings.quickSnippets },
      quickClock,
    );
    const preview = previewQuickAdd(quick, quickLists, quickClock, app.settings.clock);
    const showSuggest = quickFocus === surface && !compact && suggestOpen && suggestions.length > 0;
    const activeIndex = suggestions.length === 0 ? 0 : suggestActive % suggestions.length;
    const toggleLabel =
      surface === "drawer" ? "Close menu" : compact ? (narrow ? "Open sidebar" : "Expand sidebar") : "Collapse sidebar";
    function onToggle() {
      if (surface === "drawer") {
        setDrawer(false);
        return;
      }
      if (compact && narrow) {
        setDrawer(true);
        return;
      }
      app.toggleSidebar();
    }
    return (
    <>
      <div className="sidebar-brand">
        <button
          type="button"
          className="nav-row nav-icon sidebar-toggle"
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={onToggle}
        >
          {compact ? <PanelLeft size={16} strokeWidth={1.75} aria-hidden /> : <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden />}
        </button>
        <button
          type="button"
          className="mark mark-inline"
          inert={compact ? true : undefined}
          tabIndex={compact ? -1 : 0}
          onClick={() => leave(() => app.goToday())}
        >
          <MarkGlyph />
          <span className="nav-label">Layp</span>
        </button>
        <div className="mark-rail-slot">
          <button
            type="button"
            className="mark"
            aria-label="Layp, Today"
            title="Layp"
            inert={compact ? undefined : true}
            tabIndex={compact ? 0 : -1}
            onClick={() => app.goToday()}
          >
            <MarkGlyph />
          </button>
        </div>
      </div>
      <div className="sidebar-quick" inert={compact ? true : undefined}>
        <div className="sidebar-quick-inner">
      <form
        ref={surface === "drawer" || !drawer ? quickRef : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void addQuick();
        }}
      >
        <div
          className="quick-add"
          ref={(node) => {
            quickAnchors.current[surface] = node;
          }}
        >
          <label className="sr-only" htmlFor={quickId}>
            Quick add
          </label>
          <input
            id={quickId}
            className="quick-add-input"
            placeholder="call mom tomorrow 9am"
            value={quick}
            maxLength={500}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggest}
            aria-controls={showSuggest ? `${quickId}-suggestions` : undefined}
            aria-activedescendant={showSuggest ? `${quickId}-opt-${activeIndex}` : undefined}
            onFocus={() => {
              setQuickFocus(surface);
              setSuggestOpen(true);
              setSuggestActive(0);
            }}
            onBlur={() => setQuickFocus((current) => (current === surface ? null : current))}
            onChange={(event) => {
              setQuick(event.target.value);
              setQuickError(null);
              setSuggestOpen(true);
              setSuggestActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && suggestOpen) {
                event.preventDefault();
                event.stopPropagation();
                setSuggestOpen(false);
                return;
              }
              if (!showSuggest) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSuggestActive((index) => (index + 1) % suggestions.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSuggestActive((index) => (index - 1 + suggestions.length) % suggestions.length);
              } else if (event.key === "Tab" && !event.shiftKey) {
                event.preventDefault();
                const row = suggestions[activeIndex];
                if (row) acceptSuggestion(row);
              }
            }}
          />
          <button
            type="button"
            className="quick-help"
            aria-expanded={quickHelp}
            aria-controls={`${quickId}-format`}
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
        <Collapse open={quickHelp}>
          <div className="quick-help-panel" id={`${quickId}-format`}>
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
                  <span>in 3 days</span>
                  <span>in 2 weeks</span>
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
              <div>
                <dt>Saved</dt>
                <dd className="quick-help-bits">
                  <span>/gym fills a line from Settings</span>
                </dd>
              </div>
            </dl>
          </div>
        </Collapse>
        {quickFocus === surface && !compact && preview ? (
          <p className="quick-preview" role="status">
            {preview}
          </p>
        ) : null}
        {quickError ? (
          <p role="status" className="meta mt-1 text-danger">
            {quickError}
          </p>
        ) : null}
        {showSuggest && suggestBox
          ? createPortal(
              <div
                className="quick-suggest"
                id={`${quickId}-suggestions`}
                role="listbox"
                style={{ top: suggestBox.top, left: suggestBox.left, width: suggestBox.width }}
              >
                {suggestions.map((row, index) => (
                  <button
                    key={row.id}
                    id={`${quickId}-opt-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className="quick-suggest-option"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      acceptSuggestion(row);
                    }}
                  >
                    <span>{row.label}</span>
                    {row.detail ? <span className="quick-suggest-detail">{row.detail}</span> : null}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </form>
        </div>
      </div>

      <div className="grid gap-1">
        <Destination compact={compact} icon="today" label="Today" current={app.route.screen === "today"} onClick={() => leave(() => app.goToday())} />
        {inbox ? (
          <Destination
            compact={compact}
            icon="inbox"
            label="Inbox"
            current={app.route.screen === "list" && app.route.listId === inbox.id}
            onClick={() => leave(() => app.goList(inbox.id))}
          />
        ) : null}
        <Destination compact={compact} icon="upcoming" label="Upcoming" current={app.route.screen === "upcoming"} onClick={() => leave(() => app.goUpcoming())} />
        <Destination compact={compact} icon="calendar" label="Calendar" current={app.route.screen === "calendar"} onClick={() => leave(() => app.goCalendar())} />
      </div>

      <div className="sidebar-more-slot">
        <button
          type="button"
          className="nav-row"
          aria-label="More"
          title="More"
          inert={compact ? undefined : true}
          tabIndex={compact ? 0 : -1}
          onClick={() => setDrawer(true)}
        >
          <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
          <span className="nav-label" aria-hidden="true">
            More
          </span>
        </button>
      </div>

      <div className="sidebar-fold" inert={compact ? true : undefined}>
        <div className="sidebar-fold-inner">
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
            <div key={folder.id}>
              <div className="grid gap-1">
                <button
                  type="button"
                  className="nav-row min-w-0"
                  aria-expanded={open}
                  onClick={() => setFolderOpen((current) => ({ ...current, [folder.id]: !open }))}
                >
                  <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
                  <span className="truncate">{folder.name}</span>
                </button>
                <div className="flex flex-wrap gap-1">
                  <Button small aria-label={`Move ${folder.name} up`} onClick={() => void moveFolder(folder.id, -1)}>
                    Up
                  </Button>
                  <Button small aria-label={`Move ${folder.name} down`} onClick={() => void moveFolder(folder.id, 1)}>
                    Down
                  </Button>
                  <Button small aria-label={`Rename ${folder.name}`} onClick={() => setRenamingFolder(folder)}>
                    Rename
                  </Button>
                  <Button small aria-label={`Delete ${folder.name}`} onClick={() => setDeletingFolder(folder)}>
                    Delete
                  </Button>
                </div>
              </div>
              <Collapse open={open} className="collapse-gap-sm">
                <div className="grid gap-1">
                  {inFolder.map((list) => (
                    <ListLink key={list.id} id={list.id} folders={folders} onOpen={() => setDrawer(false)} />
                  ))}
                </div>
              </Collapse>
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
              aria-label={`Edit ${countdown.title}`}
              onClick={() => {
                setCountdownsOpen(true);
                setEditingCountdown(countdown);
              }}
            >
              Edit
            </Button>
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
        {filters.map((filter, index) => (
          <div key={filter.id} className="grid gap-1">
            <button
              type="button"
              className="nav-row"
              aria-current={app.route.screen === "filter" && app.route.filterId === filter.id ? "page" : undefined}
              onClick={() => leave(() => app.goFilter(filter.id))}
            >
              <span className="truncate">{filter.name}</span>
            </button>
            <div className="flex flex-wrap gap-1">
              <Button
                small
                aria-label={`Move ${filter.name} up`}
                aria-disabled={index === 0}
                disabled={index === 0}
                onClick={() => void moveFilter(filter.id, -1)}
              >
                Up
              </Button>
              <Button
                small
                aria-label={`Move ${filter.name} down`}
                aria-disabled={index === filters.length - 1}
                disabled={index === filters.length - 1}
                onClick={() => void moveFilter(filter.id, 1)}
              >
                Down
              </Button>
              <Button small aria-label={`Edit ${filter.name}`} onClick={() => setEditingFilter(filter)}>
                Edit
              </Button>
            </div>
          </div>
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
        </div>
      </div>

    </>
    );
  }

  function settingsRow(compact: boolean) {
    return (
      <Destination
        compact={compact}
        icon="settings"
        label="Settings"
        current={app.route.screen === "settings"}
        onClick={() => leave(() => app.goSettings())}
      />
    );
  }

  return (
    <>
      <aside className="sidebar" data-compact={rail ? "true" : undefined} aria-label="Sidebar">
        <div className="sidebar-scroll">
          <div className="sidebar-face">{sidebarBody("dock")}</div>
        </div>
        {settingsRow(rail)}
      </aside>
      {drawerPresence.mounted ? (
        <>
          <button
            type="button"
            className="sidebar-scrim"
            data-open={drawerPresence.shown ? "true" : "false"}
            aria-label="Close sidebar"
            onClick={() => setDrawer(false)}
          />
          <aside ref={drawerRef} className="sidebar sidebar-drawer" data-open={drawerPresence.shown ? "true" : "false"} aria-label="Sidebar">
            <div className="sidebar-scroll">
              <div className="sidebar-face">{sidebarBody("drawer")}</div>
            </div>
            {settingsRow(false)}
          </aside>
        </>
      ) : null}
      <Presence open={creating}>
        {creating ? <NewListDialog onClose={() => setCreating(false)} /> : null}
      </Presence>
      <Presence open={makingFolder}>
        {makingFolder ? <FolderDialog onClose={() => setMakingFolder(false)} /> : null}
      </Presence>
      <Presence open={renamingFolder !== null}>
        {renamingFolder ? <RenameFolderDialog folder={renamingFolder} onClose={() => setRenamingFolder(null)} /> : null}
      </Presence>
      <Presence open={deletingFolder !== null}>
        {deletingFolder ? <DeleteFolderDialog folder={deletingFolder} onClose={() => setDeletingFolder(null)} /> : null}
      </Presence>
      <Presence open={makingCountdown}>
        {makingCountdown ? <CountdownDialog initial={null} onClose={() => setMakingCountdown(false)} /> : null}
      </Presence>
      <Presence open={editingCountdown !== null}>
        {editingCountdown ? <CountdownDialog initial={editingCountdown} onClose={() => setEditingCountdown(null)} /> : null}
      </Presence>
      <Presence open={makingFilter}>
        {makingFilter ? <FilterDialog initial={null} onClose={() => setMakingFilter(false)} /> : null}
      </Presence>
      <Presence open={editingFilter !== null}>
        {editingFilter ? <FilterDialog initial={editingFilter} onClose={() => setEditingFilter(null)} /> : null}
      </Presence>
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
      <Presence open={menu}>
        {menu ? <ListMenu listId={list.id} folders={folders} onClose={() => setMenu(false)} /> : null}
      </Presence>
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

function RenameFolderDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const result = await renameFolder(folder, name);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    app.bump();
    onClose();
  }

  return (
    <Dialog title="Rename folder" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        {error ? <p className="meta text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="primary" type="submit">
            Rename
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteFolderDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const app = useApp();
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const result = await deleteFolder(folder.id);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    app.bump();
    onClose();
  }

  return (
    <Dialog title="Delete folder?" onClose={onClose}>
      <p>Lists in this folder stay, with no folder.</p>
      {error ? <p className="meta mt-2 text-danger">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <Button variant="danger" onClick={() => void remove()}>
          Delete
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

export function CountdownDialog({ initial, onClose }: { initial: Countdown | null; onClose: () => void }) {
  const app = useApp();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.targetOn ?? app.civilToday);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const result = initial ? await updateCountdown(initial, title, date) : await createCountdown(title, date);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    app.bump();
    onClose();
  }

  return (
    <Dialog title={initial ? "Edit countdown" : "Add countdown"} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Countdown" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
        <Field label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        {error ? <p className="meta text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="primary" type="submit">
            {initial ? "Save" : "Add countdown"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function FilterDialog({ initial, onClose }: { initial: SavedFilter | null; onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState(initial?.name ?? "");
  const [rule, setRule] = useState<FilterRule>(() => (initial ? { ...initial.rule } : emptyRule()));
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
    const result = initial ? await updateFilter(initial, name, rule) : await createFilter(name, rule);
    if (result.status !== "saved") {
      setError(result.status === "error" ? result.message : "Not saved");
      return;
    }
    app.bump();
    if (!initial) app.goFilter(result.row.id);
    onClose();
  }

  return (
    <Dialog title={initial ? "Edit filter" : "New filter"} onClose={onClose}>
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
