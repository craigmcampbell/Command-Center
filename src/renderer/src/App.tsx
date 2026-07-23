// The UI. Runs sandboxed — it can only reach the main process through the
// `window.api` object that the preload set up. No Node, no fs, no exec here.

import { useCallback, useEffect, useState } from "react";
import type {
  DockerResult,
  DailyNoteResult,
  GitHubStatusResult,
  LinkItem,
  MissionsResult,
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
} from "../../shared/types";
import DockerWidget from "./components/DockerWidget";
import GitHubWidget from "./components/GitHubWidget";
import YnabAccountsWidget from "./components/YnabAccountsWidget";
import YnabUnapprovedWidget from "./components/YnabUnapprovedWidget";
import YnabScheduledWidget from "./components/YnabScheduledWidget";
import FinanceReviewLogWidget from "./components/FinanceReviewLogWidget";
import ManagedProcessesWidget from "./components/ManagedProcessesWidget";
import DailyNoteWidget from "./components/DailyNoteWidget";
import MissionsWidget from "./components/MissionsWidget";
import TodoistWidget from "./components/TodoistWidget";
import LinkLauncherWidget, { toDisplayBasename } from "./components/LinkLauncherWidget";
import ClaudeLauncherWidget from "./components/ClaudeLauncherWidget";
import CalendarWidget from "./components/CalendarWidget";
import ReaderWidget from "./components/ReaderWidget";
import ScratchpadWidget from "./components/ScratchpadWidget";
import HabitsWidget from "./components/HabitsWidget";
import NotesWidget from "./components/NotesWidget";
import CommandPalette from "./components/CommandPalette";
import SettingsPage from "./components/SettingsPage";
import { IconGear, IconRefresh } from "./components/icons";
import type { PaletteContext } from "./palette";
import appLogo from "./assets/icon.png";

type TabId =
  | "home"
  | "development"
  | "reader"
  | "scratchpad"
  | "habits"
  | "notes"
  | "finances";

const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "development", label: "Development" },
  { id: "reader", label: "Reader" },
  { id: "scratchpad", label: "Scratchpad" },
  { id: "habits", label: "Habits" },
  { id: "notes", label: "Notes" },
  { id: "finances", label: "Finances" },
];

const DEFAULT_REFRESH_MINUTES = 10;
const DEFAULT_DOCKER_REFRESH_SECONDS = 15;
const DEFAULT_GITHUB_REFRESH_SECONDS = 300;
const DEFAULT_YNAB_REFRESH_SECONDS = 300;

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
  const [processConfigs, setProcessConfigs] = useState<ProcessConfig[]>([]);
  const [processStatuses, setProcessStatuses] = useState<ProcessStatus[]>([]);
  const [ynabAccounts, setYnabAccounts] = useState<YnabAccountsResult | null>(null);
  const [ynabUnapproved, setYnabUnapproved] = useState<YnabUnapprovedResult | null>(null);
  const [ynabScheduled, setYnabScheduled] = useState<YnabScheduledResult | null>(null);
  const [ynabCategories, setYnabCategories] = useState<YnabCategoriesResult | null>(null);
  const [financeReviewLog, setFinanceReviewLog] = useState<NoteContent | null>(null);
  const [ynabRefreshSeconds, setYnabRefreshSeconds] = useState(DEFAULT_YNAB_REFRESH_SECONDS);

  const loadDocker = useCallback(async () => {
    setDocker(await window.api.docker.list());
  }, []);
  const loadGithub = useCallback(async () => {
    setGithub(await window.api.github.status());
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
      loadProcessStatuses(),
      loadYnab(),
      loadFinanceReviewLog(),
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
    loadProcessStatuses,
    loadYnab,
    loadFinanceReviewLog,
  ]);

  const newScratchpadNote = useCallback(async () => {
    await window.api.scratchpad.clear();
    setActiveTab("scratchpad");
  }, []);

  // ---- command palette: global ⌘K/Ctrl+K toggle, works from any tab ----
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const paletteContext: PaletteContext = {
    tabs: TABS,
    onNavigateTab: (id) => setActiveTab(id as TabId),
    claudeProjects,
    localApps,
    learning,
    fileLinks,
    docker,
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
      setProcessConfigs(cfg.processes ?? []);
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
        loadProcessStatuses(),
        loadYnab(),
        loadFinanceReviewLog(),
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

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "home" && (
        <main className="grid grid-home">
          <div className="slot slot-calendar">
            <CalendarWidget data={calendar} onNavigate={navigateCalendar} onConnect={connectCalendar} />
          </div>
          <div className="slot slot-todoist">
            <TodoistWidget data={todoist} onRefresh={loadTodoist} />
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
          <div className="slot slot-github">
            <GitHubWidget data={github} />
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
            <NotesWidget />
          </div>
        </main>
      )}

      {activeTab === "finances" && (
        <main className="grid grid-finances">
          <div className="slot slot-ynab-accounts">
            <YnabAccountsWidget data={ynabAccounts} onChange={setYnabAccounts} />
          </div>
          <div className="slot slot-ynab-scheduled">
            <YnabScheduledWidget data={ynabScheduled} />
          </div>
          <div className="slot slot-ynab-financelog">
            <FinanceReviewLogWidget data={financeReviewLog} />
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
        onYnabRefreshSecondsChange={setYnabRefreshSeconds}
      />
    </>
  );
}
