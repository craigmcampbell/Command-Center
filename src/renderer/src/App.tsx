// The UI. Runs sandboxed — it can only reach the main process through the
// `window.api` object that the preload set up. No Node, no fs, no exec here.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DockerResult,
  DailyNoteResult,
  ClaudeSessionsResult,
  ClaudeUsageResult,
  GitHubStatusResult,
  GitStatusResult,
  LinkItem,
  NotificationSettings,
  MissionsResult,
  NoteNavItem,
  ProcessConfig,
  ProcessStatus,
  ReaderResult,
  TodoistResult,
  CalendarResult,
  YnabAccountsResult,
  YnabUnapprovedResult,
  YnabScheduledResult,
  YnabCategoriesResult,
  NoteContent,
  BillItem,
  CardItem,
  TabConfig,
  OpenRouterUsageResult,
  OpenRouterPeriod,
} from "../../shared/types";
import DockerWidget from "./components/DockerWidget";
import GitHubWidget from "./components/GitHubWidget";
import GitStatusWidget from "./components/GitStatusWidget";
import YnabAccountsWidget from "./components/YnabAccountsWidget";
import YnabUnapprovedWidget from "./components/YnabUnapprovedWidget";
import BillsWidget from "./components/BillsWidget";
import FinanceReviewLogWidget from "./components/FinanceReviewLogWidget";
import ManagedProcessesWidget from "./components/ManagedProcessesWidget";
import DailyNoteWidget from "./components/DailyNoteWidget";
import MissionsWidget from "./components/MissionsWidget";
import TodoistWidget from "./components/TodoistWidget";
import LinkLauncherWidget, { toDisplayBasename } from "./components/LinkLauncherWidget";
import ClaudeLauncherWidget from "./components/ClaudeLauncherWidget";
import ClaudeUsageWidget, { ClaudeBreakdown } from "./components/ClaudeUsageWidget";
import ClaudeSessionsWidget from "./components/ClaudeSessionsWidget";
import OpenRouterUsageWidget, { OpenRouterBreakdown } from "./components/OpenRouterUsageWidget";
import CalendarWidget from "./components/CalendarWidget";
import ReaderWidget from "./components/ReaderWidget";
import ScratchpadWidget from "./components/ScratchpadWidget";
import HabitsWidget from "./components/HabitsWidget";
import NotesWidget from "./components/NotesWidget";
import TabBar from "./components/TabBar";
import CommandPalette from "./components/CommandPalette";
import SettingsPage from "./components/SettingsPage";
import { IconGear, IconRefresh } from "./components/icons";
import type { PaletteContext } from "./palette";
import { buildSnapshot, diffAlerts, summarize } from "./lib/alerts";
import type { AlertSnapshot } from "./lib/alerts";
import appLogo from "./assets/icon.png";

type TabId =
  | "home"
  | "development"
  | "reader"
  | "scratchpad"
  | "habits"
  | "notes"
  | "finances"
  | "claude"
  | "openrouter";

// Fallback order/labels for the very first render, before settings.getAll()
// resolves with the DB-backed rows (services/settings.ts's DEFAULT_TABS is
// the source of truth for what gets seeded — keep these in sync with it).
const DEFAULT_TABS: TabConfig[] = [
  { id: "home", label: "Home", sortOrder: 0 },
  { id: "development", label: "Development", sortOrder: 1 },
  { id: "reader", label: "Reader", sortOrder: 2 },
  { id: "scratchpad", label: "Scratchpad", sortOrder: 3 },
  { id: "habits", label: "Habits", sortOrder: 4 },
  { id: "notes", label: "Notes", sortOrder: 5 },
  { id: "finances", label: "Finances", sortOrder: 6 },
  { id: "claude", label: "Claude", sortOrder: 7 },
  { id: "openrouter", label: "OpenRouter", sortOrder: 8 },
];

const DEFAULT_REFRESH_MINUTES = 10;
const DEFAULT_DOCKER_REFRESH_SECONDS = 15;
const DEFAULT_GITHUB_REFRESH_SECONDS = 300;
// Much faster than GitHub's: that one is slow to protect the API rate limit,
// while local git costs nothing and should react to a file you just touched.
const DEFAULT_GIT_REFRESH_SECONDS = 30;
const DEFAULT_YNAB_REFRESH_SECONDS = 300;
// Usage/cost data, not something reacting to in real time — a longer default
// than GitHub's keeps this well clear of any per-key rate limit on the
// Management API's N+1 /activity calls.
const DEFAULT_OPENROUTER_REFRESH_SECONDS = 900;

function tickClock(): string {
  return new Date()
    .toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
}

function formatRefreshTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function App() {
  const [docker, setDocker] = useState<DockerResult | null>(null);
  const [daily, setDaily] = useState<DailyNoteResult | null>(null);
  const [missions, setMissions] = useState<MissionsResult | null>(null);
  const [todoist, setTodoist] = useState<TodoistResult | null>(null);
  const [clock, setClock] = useState(tickClock());
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [tabOrder, setTabOrder] = useState<TabConfig[]>(DEFAULT_TABS);
  const [dailyDate, setDailyDate] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CalendarResult | null>(null);
  const [calendarDate, setCalendarDate] = useState<string | null>(null);
  const [localApps, setLocalApps] = useState<LinkItem[]>([]);
  const [learning, setLearning] = useState<LinkItem[]>([]);
  const [claudeProjects, setClaudeProjects] = useState<LinkItem[]>([]);
  const [fileLinks, setFileLinks] = useState<LinkItem[]>([]);
  const [reader, setReader] = useState<ReaderResult | null>(null);
  const [readerPage, setReaderPage] = useState(0);
  const [appRefreshMinutes, setAppRefreshMinutes] = useState(DEFAULT_REFRESH_MINUTES);
  const [dockerRefreshSeconds, setDockerRefreshSeconds] = useState(DEFAULT_DOCKER_REFRESH_SECONDS);
  const [githubRefreshSeconds, setGithubRefreshSeconds] = useState(DEFAULT_GITHUB_REFRESH_SECONDS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [github, setGithub] = useState<GitHubStatusResult | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [claudeUsage, setClaudeUsage] = useState<ClaudeUsageResult | null>(null);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSessionsResult | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({});
  // Previous poll's snapshot, for edge-triggered alerting. A ref, not state:
  // updating it must not itself cause a render, or the alert effect would
  // re-run and compare a snapshot against itself.
  const prevSnapshot = useRef<AlertSnapshot | null>(null);
  const [gitRefreshSeconds, setGitRefreshSeconds] = useState(DEFAULT_GIT_REFRESH_SECONDS);
  const [processConfigs, setProcessConfigs] = useState<ProcessConfig[]>([]);
  // Mirrors NotesWidget's nav list so the command palette can offer pinned
  // notes. NotesWidget stays the owner and pushes changes up — same shape as
  // SettingsPage pushing processConfigs here.
  const [navNotes, setNavNotes] = useState<NoteNavItem[]>([]);
  const [pendingNoteOpen, setPendingNoteOpen] = useState<NoteNavItem | null>(null);
  const [processStatuses, setProcessStatuses] = useState<ProcessStatus[]>([]);
  const [ynabAccounts, setYnabAccounts] = useState<YnabAccountsResult | null>(null);
  const [ynabUnapproved, setYnabUnapproved] = useState<YnabUnapprovedResult | null>(null);
  const [ynabScheduled, setYnabScheduled] = useState<YnabScheduledResult | null>(null);
  const [ynabCategories, setYnabCategories] = useState<YnabCategoriesResult | null>(null);
  const [financeReviewLog, setFinanceReviewLog] = useState<NoteContent | null>(null);
  const [bills, setBills] = useState<BillItem[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [ynabRefreshSeconds, setYnabRefreshSeconds] = useState(DEFAULT_YNAB_REFRESH_SECONDS);
  const [showTimeTracking, setShowTimeTracking] = useState(true);
  const [openRouterUsage, setOpenRouterUsage] = useState<OpenRouterUsageResult | null>(null);
  const [openRouterPeriod, setOpenRouterPeriod] = useState<OpenRouterPeriod>("30d");
  const [openRouterRefreshSeconds, setOpenRouterRefreshSeconds] = useState(
    DEFAULT_OPENROUTER_REFRESH_SECONDS
  );

  const loadDocker = useCallback(async () => {
    setDocker(await window.api.docker.list());
  }, []);
  const loadGithub = useCallback(async () => {
    setGithub(await window.api.github.status());
  }, []);
  const loadGit = useCallback(async () => {
    setGitStatus(await window.api.git.status());
  }, []);
  // One scan serves both, and the service memoizes per file — so the second
  // call here is effectively free rather than a second pass over ~400MB.
  const loadClaude = useCallback(async () => {
    setClaudeUsage(await window.api.claude.usage());
    // Grouped by project now, so a small cap mostly shows one dominant
    // project's most recent work and starves quieter ones out of the list
    // entirely — 40 gives every active project a real chance to appear.
    setClaudeSessions(await window.api.claude.sessions(40));
  }, []);
  const loadProcessStatuses = useCallback(async () => {
    setProcessStatuses(await window.api.process.statusAll());
  }, []);
  const loadYnabUnapproved = useCallback(async () => {
    setYnabUnapproved(await window.api.ynab.unapprovedTransactions());
  }, []);
  const loadYnab = useCallback(async () => {
    await Promise.all([
      window.api.ynab.accounts().then(setYnabAccounts),
      loadYnabUnapproved(),
      window.api.ynab.scheduledTransactions().then(setYnabScheduled),
      window.api.ynab.categories().then(setYnabCategories),
    ]);
  }, [loadYnabUnapproved]);
  const loadFinanceReviewLog = useCallback(async () => {
    setFinanceReviewLog(await window.api.grimoire.financeReviewLog());
  }, []);
  const loadBills = useCallback(async () => {
    setBills(await window.api.bills.list());
  }, []);
  const loadCards = useCallback(async () => {
    setCards(await window.api.cards.list());
  }, []);
  const loadDaily = useCallback(async () => {
    setDaily(await window.api.grimoire.dailyNote(dailyDate ?? undefined));
  }, [dailyDate]);
  const loadMissions = useCallback(async () => {
    setMissions(await window.api.grimoire.missions());
  }, []);
  const loadTodoist = useCallback(async () => {
    setTodoist(await window.api.todoist.tasks());
  }, []);
  const loadCalendar = useCallback(async () => {
    setCalendar(await window.api.calendar.events(calendarDate ?? undefined));
  }, [calendarDate]);
  const loadReader = useCallback(async (page: number, forceRefresh = false) => {
    setReaderPage(page);
    setReader(await window.api.reader.list(page, forceRefresh));
  }, []);
  const loadOpenRouter = useCallback(async () => {
    setOpenRouterUsage(await window.api.openrouter.usage(openRouterPeriod));
  }, [openRouterPeriod]);

  const navigateDaily = useCallback(async (date: string | null) => {
    setDailyDate(date);
    setDaily(await window.api.grimoire.dailyNote(date ?? undefined));
  }, []);

  const navigateCalendar = useCallback(async (date: string) => {
    setCalendarDate(date);
    setCalendar(await window.api.calendar.events(date));
  }, []);

  const connectCalendar = useCallback(async () => {
    const res = await window.api.calendar.connect();
    if (res.ok) {
      setCalendar(await window.api.calendar.events(calendarDate ?? undefined));
    }
  }, [calendarDate]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadDocker(),
      loadDaily(),
      loadMissions(),
      loadTodoist(),
      loadCalendar(),
      loadReader(readerPage, true),
      loadGithub(),
      loadGit(),
      loadClaude(),
      loadProcessStatuses(),
      loadYnab(),
      loadFinanceReviewLog(),
      loadBills(),
      loadCards(),
      loadOpenRouter(),
    ]);
    setRefreshing(false);
    setLastRefreshedAt(new Date());
  }, [
    loadDocker,
    loadDaily,
    loadMissions,
    loadTodoist,
    loadCalendar,
    loadReader,
    readerPage,
    loadGithub,
    loadGit,
    loadClaude,
    loadProcessStatuses,
    loadYnab,
    loadFinanceReviewLog,
    loadBills,
    loadCards,
    loadOpenRouter,
  ]);

  const newScratchpadNote = useCallback(async () => {
    await window.api.scratchpad.clear();
    setActiveTab("scratchpad");
  }, []);

  const renameTab = useCallback(async (id: string, label: string) => {
    setTabOrder(await window.api.settings.tabs.rename(id, label));
  }, []);

  const reorderTabs = useCallback(async (orderedIds: string[]) => {
    setTabOrder(await window.api.settings.tabs.reorder(orderedIds));
  }, []);

  // ---- command palette: global ⌘P/Ctrl+P toggle, works from any tab ----
  // Not ⌘K: that's the near-universal "insert link" shortcut in a markdown
  // editor, and this listener is on `window` with preventDefault, so it would
  // always beat CodeMirror's binding no matter what the editor asked for.
  // ⌘P would otherwise be Print, which this app has no use for.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const paletteContext: PaletteContext = {
    tabs: tabOrder,
    onNavigateTab: (id) => setActiveTab(id as TabId),
    claudeProjects,
    localApps,
    learning,
    fileLinks,
    docker,
    navNotes,
    onOpenNote: (item) => {
      setActiveTab("notes");
      setPendingNoteOpen(item);
    },
    onRefreshDocker: loadDocker,
    onRefreshAll: refreshAll,
    onNewScratchpadNote: newScratchpadNote,
  };

  // ---- boot: load settings, then every widget, then start Processes' refresh ----
  // Docker's + GitHub's refresh intervals live in their own effects below,
  // keyed on dockerRefreshSeconds/githubRefreshSeconds, so a live Settings
  // edit to either takes effect without a restart.
  useEffect(() => {
    let processesIntervalId: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const cfg = await window.api.settings.getAll();
      setAppRefreshMinutes(cfg.app?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES);
      setDockerRefreshSeconds(cfg.docker?.refreshSeconds || DEFAULT_DOCKER_REFRESH_SECONDS);
      setGithubRefreshSeconds(cfg.github?.refreshSeconds || DEFAULT_GITHUB_REFRESH_SECONDS);
      setYnabRefreshSeconds(cfg.ynab?.refreshSeconds || DEFAULT_YNAB_REFRESH_SECONDS);
      setOpenRouterRefreshSeconds(
        cfg.openrouter?.refreshSeconds || DEFAULT_OPENROUTER_REFRESH_SECONDS
      );
      setGitRefreshSeconds(cfg.git?.refreshSeconds || DEFAULT_GIT_REFRESH_SECONDS);
      setNotificationSettings(cfg.notifications ?? {});
      setShowTimeTracking(cfg.todoist?.showTimeTracking !== false);
      setProcessConfigs(cfg.processes ?? []);
      if (cfg.tabs && cfg.tabs.length > 0) setTabOrder(cfg.tabs);
      await Promise.all([
        loadDocker(),
        loadDaily(),
        loadMissions(),
        loadTodoist(),
        loadCalendar(),
        window.api.links.list("localApps").then(setLocalApps),
        window.api.links.list("learning").then(setLearning),
        window.api.links.list("claudeCode").then(setClaudeProjects),
        window.api.links.list("fileLinks").then(setFileLinks),
        loadReader(0),
        loadGithub(),
        loadGit(),
        loadClaude(),
        loadProcessStatuses(),
        loadYnab(),
        loadFinanceReviewLog(),
        loadBills(),
        loadCards(),
        loadOpenRouter(),
      ]);
      setLastRefreshedAt(new Date());

      // Pips only need to be "roughly fresh" — the widget itself polls
      // faster (window.api.process.status) for whichever row's logs panel
      // is actually open.
      processesIntervalId = setInterval(loadProcessStatuses, 3000);
    })();
    return () => {
      clearInterval(processesIntervalId);
    };
    // Intentionally empty: this must run once at mount only. loadDaily/loadCalendar's
    // identity changes whenever dailyDate/calendarDate does (prev/next navigation), and
    // re-running this effect would stack a second Processes refresh interval.
  }, []);

  // ---- Docker refresh, reactive to Settings edits ----
  useEffect(() => {
    const id = setInterval(loadDocker, dockerRefreshSeconds * 1000);
    return () => clearInterval(id);
  }, [loadDocker, dockerRefreshSeconds]);

  // ---- GitHub refresh, reactive to Settings edits ----
  useEffect(() => {
    const id = setInterval(loadGithub, githubRefreshSeconds * 1000);
    return () => clearInterval(id);
  }, [loadGithub, githubRefreshSeconds]);

  // ---- OpenRouter refresh, reactive to Settings edits and period changes ----
  useEffect(() => {
    const id = setInterval(loadOpenRouter, openRouterRefreshSeconds * 1000);
    return () => clearInterval(id);
  }, [loadOpenRouter, openRouterRefreshSeconds]);

  // Switching the period should refetch immediately rather than waiting for
  // the next interval tick.
  useEffect(() => {
    void loadOpenRouter();
    // loadOpenRouter's identity already changes with openRouterPeriod, so
    // depending on it alone would double-fire; depend on the period instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRouterPeriod]);

  // ---- alerts + tray, derived from state the widgets already poll ----
  // No new polling: this reacts to github/processStatuses/docker changing,
  // each of which has its own interval elsewhere in this file.
  useEffect(() => {
    const next = buildSnapshot(github, processStatuses, docker);
    for (const alert of diffAlerts(prevSnapshot.current, next, notificationSettings, processConfigs)) {
      void window.api.notifications.show(alert);
    }
    prevSnapshot.current = next;
    void window.api.tray.update(summarize(next));
  }, [github, processStatuses, docker, notificationSettings, processConfigs]);

  // ---- commands pushed from main (tray menu, notification clicks) ----
  useEffect(() => {
    return window.api.onCommand((command) => {
      if (command.type === "refreshAll") void refreshAll();
      else if (command.type === "openTab") setActiveTab(command.tab as TabId);
      else if (command.type === "captured" && command.target === "dailyNote") {
        // Capture appended to today's note in main; re-read it so the widget
        // isn't holding a stale copy it would later autosave over the top of.
        // Only when we're actually showing today — if the user has navigated
        // to another date, there's nothing stale to correct.
        if (!dailyDate) void loadDaily();
      }
    });
  }, [refreshAll, dailyDate, loadDaily]);

  // ---- Git refresh, reactive to Settings edits ----
  useEffect(() => {
    const id = setInterval(loadGit, gitRefreshSeconds * 1000);
    return () => clearInterval(id);
  }, [loadGit, gitRefreshSeconds]);

  // ---- YNAB refresh, reactive to Settings edits ----
  useEffect(() => {
    const id = setInterval(loadYnab, ynabRefreshSeconds * 1000);
    return () => clearInterval(id);
  }, [loadYnab, ynabRefreshSeconds]);

  // ---- clock / stardate ----
  useEffect(() => {
    const id = setInterval(() => setClock(tickClock()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  // ---- periodic full refresh (same as the Refresh button) ----
  useEffect(() => {
    if (appRefreshMinutes <= 0) return;
    const id = setInterval(() => {
      void refreshAll();
    }, appRefreshMinutes * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshAll, appRefreshMinutes]);

  return (
    <>
      <div className="chrome-drag"></div>

      <header className="masthead">
        <div className="mark">
          <img src={appLogo} alt="" className="app-logo" width={28} height={28} />
          <div>
            <h1>Command Center</h1>
            <p className="stardate">{clock}</p>
          </div>
        </div>
        <div className="refresh-control">
          <div className="refresh-control-row">
            <button className="refresh" title="Refresh everything" onClick={refreshAll}>
              <IconRefresh className={refreshing ? "spin" : ""} />
              Refresh
            </button>
            <button className="settings-trigger" title="Settings" onClick={() => setSettingsOpen(true)}>
              <IconGear />
            </button>
          </div>
          {lastRefreshedAt && (
            <p className="refresh-timestamp">Last refreshed {formatRefreshTime(lastRefreshedAt)}</p>
          )}
        </div>
      </header>

      <TabBar
        tabs={tabOrder}
        activeId={activeTab}
        onSelect={(id) => setActiveTab(id as TabId)}
        onReorder={reorderTabs}
        onRename={renameTab}
      />

      {activeTab === "home" && (
        <main className="grid grid-home">
          <div className="slot slot-calendar">
            <CalendarWidget data={calendar} onNavigate={navigateCalendar} onConnect={connectCalendar} />
          </div>
          <div className="slot slot-todoist">
            <TodoistWidget data={todoist} onRefresh={loadTodoist} showTimeTracking={showTimeTracking} />
          </div>
          <div className="slot slot-daily">
            <DailyNoteWidget data={daily} onNavigate={navigateDaily} onChange={setDaily} />
          </div>
          <div className="slot slot-missions">
            <MissionsWidget data={missions} />
          </div>
          <div className="slot slot-apps">
            <LinkLauncherWidget
              title="Local Apps"
              kind="localApps"
              instances={localApps}
              onChange={setLocalApps}
            />
          </div>
          <div className="slot slot-learning">
            <LinkLauncherWidget
              title="Learning"
              kind="learning"
              instances={learning}
              onChange={setLearning}
            />
          </div>
          <div className="slot slot-filelinks">
            <LinkLauncherWidget
              title="File Links"
              kind="fileLinks"
              instances={fileLinks}
              onChange={setFileLinks}
              onLaunch={(link) => void window.api.forklift.open(link)}
              formatDisplay={toDisplayBasename}
              linkPlaceholder="/absolute/path/to/folder"
              emptyLabel="No folders configured."
            />
          </div>
        </main>
      )}

      {activeTab === "development" && (
        <main className="grid grid-dev">
          <div className="slot slot-github">
            <GitHubWidget data={github} />
          </div>
          <div className="slot slot-git">
            <GitStatusWidget data={gitStatus} />
          </div>
          <div className="slot slot-services">
            <DockerWidget data={docker} onRefresh={loadDocker} />
          </div>
          <div className="slot slot-claude">
            <ClaudeLauncherWidget
              kind="claudeCode"
              projects={claudeProjects}
              onChange={setClaudeProjects}
            />
          </div>
          <div className="slot slot-processes">
            <ManagedProcessesWidget
              configs={processConfigs}
              statuses={processStatuses}
              onRefresh={loadProcessStatuses}
            />
          </div>
        </main>
      )}

      {activeTab === "reader" && (
        <main className="grid grid-reader">
          <div className="slot slot-reader">
            <ReaderWidget data={reader} onNavigate={(page) => loadReader(page)} onChange={setReader} />
          </div>
        </main>
      )}

      {activeTab === "scratchpad" && (
        <main className="grid grid-scratchpad">
          <div className="slot slot-scratchpad">
            <ScratchpadWidget />
          </div>
        </main>
      )}

      {activeTab === "habits" && (
        <main className="grid grid-habits">
          <div className="slot slot-habits">
            <HabitsWidget />
          </div>
        </main>
      )}

      {activeTab === "notes" && (
        <main className="grid grid-notes">
          <div className="slot slot-notes">
            <NotesWidget
              onNavChange={setNavNotes}
              pendingOpen={pendingNoteOpen}
              onPendingOpenHandled={() => setPendingNoteOpen(null)}
            />
          </div>
        </main>
      )}

      {activeTab === "finances" && (
        <main className="grid grid-finances">
          <div className="slot slot-ynab-accounts">
            <YnabAccountsWidget
              accountsData={ynabAccounts}
              scheduledData={ynabScheduled}
              onChange={setYnabAccounts}
            />
          </div>
          <div className="slot slot-ynab-bills">
            <BillsWidget bills={bills} onChange={setBills} cards={cards} onCardsChange={setCards} />
          </div>
          <div className="slot slot-ynab-financelog">
            <FinanceReviewLogWidget data={financeReviewLog} onChange={setFinanceReviewLog} />
          </div>
          <div className="slot slot-ynab-unapproved">
            <YnabUnapprovedWidget
              data={ynabUnapproved}
              categories={ynabCategories}
              accounts={ynabAccounts}
              onRefresh={loadYnabUnapproved}
            />
          </div>
        </main>
      )}

      {activeTab === "claude" && (
        <main className="grid grid-claude">
          <div className="slot slot-claude-usage">
            <ClaudeUsageWidget data={claudeUsage} />
          </div>
          <div className="slot slot-claude-projects">
            <ClaudeBreakdown
              title="By project (30d)"
              rows={claudeUsage?.byProject ?? []}
              emptyLabel="No usage in the last 30 days."
            />
          </div>
          <div className="slot slot-claude-models">
            <ClaudeBreakdown
              title="By model (30d)"
              rows={claudeUsage?.byModel ?? []}
              emptyLabel="No usage in the last 30 days."
            />
          </div>
          <div className="slot slot-claude-sessions">
            <ClaudeSessionsWidget data={claudeSessions} />
          </div>
        </main>
      )}

      {activeTab === "openrouter" && (
        <main className="grid grid-openrouter">
          <div className="slot slot-openrouter-summary">
            <OpenRouterUsageWidget
              data={openRouterUsage}
              period={openRouterPeriod}
              onPeriodChange={setOpenRouterPeriod}
            />
          </div>
          <div className="slot slot-openrouter-models">
            <OpenRouterBreakdown
              title="By model"
              rows={openRouterUsage?.byModel ?? []}
              emptyLabel="No usage in this period."
            />
          </div>
          <div className="slot slot-openrouter-keys">
            <OpenRouterBreakdown
              title="By API key"
              rows={openRouterUsage?.byKey ?? []}
              emptyLabel="No usage in this period."
            />
          </div>
        </main>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        context={paletteContext}
      />

      <SettingsPage
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onProcessConfigsChange={setProcessConfigs}
        onAppRefreshMinutesChange={(minutes) => setAppRefreshMinutes(minutes ?? DEFAULT_REFRESH_MINUTES)}
        onDockerRefreshSecondsChange={setDockerRefreshSeconds}
        onGithubRefreshSecondsChange={setGithubRefreshSeconds}
        onGitRefreshSecondsChange={(seconds) =>
          setGitRefreshSeconds(seconds ?? DEFAULT_GIT_REFRESH_SECONDS)
        }
        onNotificationSettingsChange={setNotificationSettings}
        onYnabRefreshSecondsChange={setYnabRefreshSeconds}
        onTodoistShowTimeTrackingChange={setShowTimeTracking}
        onOpenRouterRefreshSecondsChange={(seconds) =>
          setOpenRouterRefreshSeconds(seconds ?? DEFAULT_OPENROUTER_REFRESH_SECONDS)
        }
      />
    </>
  );
}
