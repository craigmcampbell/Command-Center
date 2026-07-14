// The UI. Runs sandboxed — it can only reach the main process through the
// `window.api` object that the preload set up. No Node, no fs, no exec here.

import { useCallback, useEffect, useState } from "react";
import type {
  DockerResult,
  DailyNoteResult,
  GitHubStatusResult,
  LinkItem,
  MissionsResult,
  ReaderResult,
  TodoistResult,
  CalendarResult,
} from "../../shared/types";
import DockerWidget from "./components/DockerWidget";
import GitHubWidget from "./components/GitHubWidget";
import DailyNoteWidget from "./components/DailyNoteWidget";
import MissionsWidget from "./components/MissionsWidget";
import TodoistWidget from "./components/TodoistWidget";
import LinkLauncherWidget from "./components/LinkLauncherWidget";
import ClaudeLauncherWidget from "./components/ClaudeLauncherWidget";
import CalendarWidget from "./components/CalendarWidget";
import ReaderWidget from "./components/ReaderWidget";
import ScratchpadWidget from "./components/ScratchpadWidget";
import HabitsWidget from "./components/HabitsWidget";
import NotesWidget from "./components/NotesWidget";
import CommandPalette from "./components/CommandPalette";
import { IconRefresh } from "./components/icons";
import type { PaletteContext } from "./palette";
import appLogo from "./assets/icon.png";

type TabId = "home" | "development" | "reader" | "scratchpad" | "habits" | "notes";

const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "development", label: "Development" },
  { id: "reader", label: "Reader" },
  { id: "scratchpad", label: "Scratchpad" },
  { id: "habits", label: "Habits" },
  { id: "notes", label: "Notes" },
];

const DEFAULT_REFRESH_MINUTES = 10;

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
  const [reader, setReader] = useState<ReaderResult | null>(null);
  const [readerPage, setReaderPage] = useState(0);
  const [appRefreshMinutes, setAppRefreshMinutes] = useState(DEFAULT_REFRESH_MINUTES);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [github, setGithub] = useState<GitHubStatusResult | null>(null);

  const loadDocker = useCallback(async () => {
    setDocker(await window.api.docker.list());
  }, []);
  const loadGithub = useCallback(async () => {
    setGithub(await window.api.github.status());
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
    docker,
    onRefreshDocker: loadDocker,
    onRefreshAll: refreshAll,
    onNewScratchpadNote: newScratchpadNote,
  };

  // ---- boot: load config, then every widget, then start Docker's + GitHub's refresh ----
  useEffect(() => {
    let dockerIntervalId: ReturnType<typeof setInterval> | undefined;
    let githubIntervalId: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const cfg = await window.api.getConfig();
      setAppRefreshMinutes(cfg.app?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES);
      await Promise.all([
        loadDocker(),
        loadDaily(),
        loadMissions(),
        loadTodoist(),
        loadCalendar(),
        window.api.links.list("localApps").then(setLocalApps),
        window.api.links.list("learning").then(setLearning),
        window.api.links.list("claudeCode").then(setClaudeProjects),
        loadReader(0),
        loadGithub(),
      ]);
      setLastRefreshedAt(new Date());

      const dockerSecs = cfg.docker?.refreshSeconds || 15;
      dockerIntervalId = setInterval(loadDocker, dockerSecs * 1000);

      const githubSecs = cfg.github?.refreshSeconds || 300;
      githubIntervalId = setInterval(loadGithub, githubSecs * 1000);
    })();
    return () => {
      clearInterval(dockerIntervalId);
      clearInterval(githubIntervalId);
    };
    // Intentionally empty: this must run once at mount only. loadDaily/loadCalendar's
    // identity changes whenever dailyDate/calendarDate does (prev/next navigation), and
    // re-running this effect would stack a second Docker/GitHub refresh interval.
  }, []);

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
          <button className="refresh" title="Refresh everything" onClick={refreshAll}>
            <IconRefresh className={refreshing ? "spin" : ""} />
            Refresh
          </button>
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

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        context={paletteContext}
      />
    </>
  );
}
