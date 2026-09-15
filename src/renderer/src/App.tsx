import { usePolling, useWindowVisible } from "./hooks/usePolling";
import StatsPanel from "./components/StatsPanel";
// The UI. Runs sandboxed — it can only reach the main process through the
// `window.api` object that the preload set up. No Node, no fs, no exec here.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DockerResult,
  DockerUpdateCheckResult,
  SpotifyNowPlayingResult,
  DailyNoteResult,
  ClaudeSessionsResult,
  ClaudeUsageResult,
  CodexSessionsResult,
  CodexUsageResult,
  GitHubStatusResult,
  GitStatusResult,
  LinkItem,
  NotificationSettings,
  MissionsResult,
  NoteNavItem,
  ProcessConfig,
  ProcessStatus,
  ReaderResult,
  ReaderFeedResult,
  GitHubReleasesResult,
  RedditResult,
  YouTubeResult,
  TodoistResult,
  CalendarResult,
  YnabAccountsResult,
  YnabUnapprovedResult,
  YnabScheduledResult,
  YnabCategoriesResult,
  YnabPayeesResult,
  YnabMonthResult,
  NoteContent,
  BillItem,
  CardItem,
  TabConfig,
  OpenRouterUsageResult,
  OpenRouterPeriod,
  OpenAIUsageResult,
  OpenAIPeriod,
  FirecrawlUsageResult,
  StatsSettings,
} from "../../shared/types";
import DockerWidget from "./components/DockerWidget";
import NowPlayingBanner from "./components/NowPlayingBanner";
import GitHubWidget from "./components/GitHubWidget";
import GitStatusWidget from "./components/GitStatusWidget";
import YnabAccountsWidget from "./components/YnabAccountsWidget";
import YnabUnapprovedWidget from "./components/YnabUnapprovedWidget";
import BillsWidget from "./components/BillsWidget";
import BudgetHealthWidget from "./components/BudgetHealthWidget";
import FinanceReviewLogWidget from "./components/FinanceReviewLogWidget";
import ManagedProcessesWidget from "./components/ManagedProcessesWidget";
import DailyNoteWidget from "./components/DailyNoteWidget";
import MissionsWidget from "./components/MissionsWidget";
import TodoistWidget from "./components/TodoistWidget";
import LinkLauncherWidget, { toDisplayBasename } from "./components/LinkLauncherWidget";
import ClaudeLauncherWidget from "./components/ClaudeLauncherWidget";
import ClaudeUsageWidget, { ClaudeBreakdown } from "./components/ClaudeUsageWidget";
import ClaudeSessionsWidget from "./components/ClaudeSessionsWidget";
import CodexUsageWidget, { CodexBreakdown } from "./components/CodexUsageWidget";
import CodexSessionsWidget from "./components/CodexSessionsWidget";
import OpenRouterUsageWidget, { OpenRouterBreakdown } from "./components/OpenRouterUsageWidget";
import OpenAIUsageWidget, { OpenAIModelBreakdown, OpenAICostBreakdown } from "./components/OpenAIUsageWidget";
import FirecrawlUsageWidget, { FirecrawlBreakdown } from "./components/FirecrawlUsageWidget";
import CalendarWidget from "./components/CalendarWidget";
import ReaderWidget from "./components/ReaderWidget";
import ReaderFeedWidget from "./components/ReaderFeedWidget";
import GitHubReleasesWidget from "./components/GitHubReleasesWidget";
import YouTubeWidget from "./components/YouTubeWidget";
import RedditWidget from "./components/RedditWidget";
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
  | "ai"
  | "stats"
  | "social";

// The AI tab's own sub-navigation (Claude / Firecrawl / OpenRouter / OpenAI). Not
// DB-backed like the top-level tabs — just local UI state, same as
// openRouterPeriod — since four subtabs don't need reorder/rename.
type AiSubTab = "claude" | "firecrawl" | "openrouter" | "openai";

// The Reader tab's own two halves: what you saved, and what your RSS
// subscriptions delivered. Local UI state like AiSubTab — two fixed halves
// don't need reorder/rename.
type ReaderSubTab = "saved" | "feed";

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
  { id: "ai", label: "AI", sortOrder: 7 },
  { id: "stats", label: "Stats", sortOrder: 8 },
  // Appended, not slotted in: ensureTabDefaults() inserts a missing tab at
  // maxOrder + 1, so a mid-list position here would disagree with what an
  // existing install's DB actually holds. Drag-to-reorder handles placement.
  { id: "social", label: "Social", sortOrder: 9 },
];

const DEFAULT_REFRESH_MINUTES = 10;
const DEFAULT_DOCKER_REFRESH_SECONDS = 15;
const DEFAULT_DOCKER_UPDATE_CHECK_MINUTES = 60;
const DEFAULT_STATS_REFRESH_SECONDS = 5;
const DEFAULT_STATS_PUBLIC_IP_CHECK_MINUTES = 60;
const DEFAULT_GITHUB_REFRESH_SECONDS = 300;
// Local Git checks are limited to the visible Development tab.
const DEFAULT_GIT_REFRESH_SECONDS = 30;
const DEFAULT_YNAB_REFRESH_SECONDS = 300;
// Usage/cost data, not something reacting to in real time — a longer default
// than GitHub's keeps this well clear of any per-key rate limit on the
// Management API's N+1 /activity calls.
const DEFAULT_OPENROUTER_REFRESH_SECONDS = 900;
// Same rationale as OpenRouter's: usage/cost data, not real-time, and this
// one's the admin usage + costs endpoints rather than a rate-limited key.
const DEFAULT_OPENAI_REFRESH_SECONDS = 900;
const DEFAULT_FIRECRAWL_REFRESH_SECONDS = 900;

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
  const windowVisible = useWindowVisible();
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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
  const [readerSubTab, setReaderSubTab] = useState<ReaderSubTab>("saved");
  const [readerFeed, setReaderFeed] = useState<ReaderFeedResult | null>(null);
  const [readerFeedPage, setReaderFeedPage] = useState(0);
  const [readerFeedSource, setReaderFeedSource] = useState<string | null>(null);
  const [githubReleases, setGithubReleases] = useState<GitHubReleasesResult | null>(null);
  const [youtube, setYouTube] = useState<YouTubeResult | null>(null);
  const [reddit, setReddit] = useState<RedditResult | null>(null);
  const [appRefreshMinutes, setAppRefreshMinutes] = useState(DEFAULT_REFRESH_MINUTES);
  const [dockerRefreshSeconds, setDockerRefreshSeconds] = useState(DEFAULT_DOCKER_REFRESH_SECONDS);
  const [dockerUpdates, setDockerUpdates] = useState<DockerUpdateCheckResult | null>(null);
  const [dockerUpdateChecksEnabled, setDockerUpdateChecksEnabled] = useState(true);
  const [dockerUpdateCheckMinutes, setDockerUpdateCheckMinutes] = useState(
    DEFAULT_DOCKER_UPDATE_CHECK_MINUTES
  );
  const [statsRefreshSeconds, setStatsRefreshSeconds] = useState(DEFAULT_STATS_REFRESH_SECONDS);
  const [statsPublicIpEnabled, setStatsPublicIpEnabled] = useState(true);
  const [statsPublicIpCheckMinutes, setStatsPublicIpCheckMinutes] = useState(DEFAULT_STATS_PUBLIC_IP_CHECK_MINUTES);
  const [backgroundNetwork, setBackgroundNetwork] = useState(false);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [spotifyEnabled, setSpotifyEnabled] = useState(true);
  const [nowPlaying, setNowPlaying] = useState<SpotifyNowPlayingResult | null>(null);
  const [githubRefreshSeconds, setGithubRefreshSeconds] = useState(DEFAULT_GITHUB_REFRESH_SECONDS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [github, setGithub] = useState<GitHubStatusResult | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [claudeUsage, setClaudeUsage] = useState<ClaudeUsageResult | null>(null);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSessionsResult | null>(null);
  const [codexUsage, setCodexUsage] = useState<CodexUsageResult | null>(null);
  const [codexSessions, setCodexSessions] = useState<CodexSessionsResult | null>(null);
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
  const [ynabPayees, setYnabPayees] = useState<YnabPayeesResult | null>(null);
  const [budgetHealth, setBudgetHealth] = useState<YnabMonthResult | null>(null);
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
  const [openAIUsage, setOpenAIUsage] = useState<OpenAIUsageResult | null>(null);
  const [openAIPeriod, setOpenAIPeriod] = useState<OpenAIPeriod>("30d");
  const [openAIRefreshSeconds, setOpenAIRefreshSeconds] = useState(DEFAULT_OPENAI_REFRESH_SECONDS);
  const [firecrawlUsage, setFirecrawlUsage] = useState<FirecrawlUsageResult | null>(null);
  const [firecrawlRefreshSeconds, setFirecrawlRefreshSeconds] = useState(
    DEFAULT_FIRECRAWL_REFRESH_SECONDS
  );
  const [aiSubTab, setAiSubTab] = useState<AiSubTab>("claude");

  const loadDocker = useCallback(async () => {
    setDocker(await window.api.docker.list());
  }, []);
  // Deliberately not part of refreshAll's Promise.all — registry lookups can
  // be rate-limited, so this only runs from its own interval and the widget's
  // manual "check now" button, never from the fast "refresh everything" path.
  const loadDockerUpdates = useCallback(async () => {
    setDockerUpdates(await window.api.docker.checkUpdates());
  }, []);
  const loadNowPlaying = useCallback(async () => {
    const next = await window.api.spotify.nowPlaying();
    setNowPlaying((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const loadGithub = useCallback(async () => {
    setGithub(await window.api.github.status());
  }, []);
  const loadGit = useCallback(async () => {
    setGitStatus(await window.api.git.status());
  }, []);
  // The worker shares indexed scan results between usage and sessions.
  const loadClaude = useCallback(async () => {
    setClaudeUsage(await window.api.claude.usage());
    // Grouped by project now, so a small cap mostly shows one dominant
    // project's most recent work and starves quieter ones out of the list
    // entirely — 40 gives every active project a real chance to appear.
    setClaudeSessions(await window.api.claude.sessions(40));
  }, []);
  const loadCodex = useCallback(async () => {
    // Usage scans every active + archived transcript. Let it populate the
    // service's per-file cache before the active-session fallback asks for
    // transcript metadata, avoiding two concurrent cold parses.
    setCodexUsage(await window.api.codex.usage());
    setCodexSessions(await window.api.codex.sessions(40));
  }, []);
  const loadProcessStatuses = useCallback(async () => {
    const next = await window.api.process.statusAll();
    setProcessStatuses((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const loadYnabUnapproved = useCallback(async () => {
    setYnabUnapproved(await window.api.ynab.unapprovedTransactions());
  }, []);
  const loadBudgetHealth = useCallback(async () => {
    setBudgetHealth(await window.api.ynab.currentMonth());
  }, []);
  const loadYnab = useCallback(async () => {
    await Promise.all([
      window.api.ynab.accounts().then(setYnabAccounts),
      loadYnabUnapproved(),
      window.api.ynab.scheduledTransactions().then(setYnabScheduled),
      window.api.ynab.categories().then(setYnabCategories),
      window.api.ynab.payees().then(setYnabPayees),
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
  const loadReaderFeed = useCallback(
    async (page: number, source: string | null, forceRefresh = false) => {
      setReaderFeedPage(page);
      setReaderFeedSource(source);
      setReaderFeed(await window.api.reader.feed(page, source, forceRefresh));
    },
    []
  );
  const loadGithubReleases = useCallback(async (forceRefresh = false) => {
    setGithubReleases(await window.api.github.releases(forceRefresh));
  }, []);
  const loadYouTube = useCallback(async (forceRefresh = false) => {
    setYouTube(await window.api.youtube.list(forceRefresh));
  }, []);
  const loadReddit = useCallback(async (forceRefresh = false) => {
    setReddit(await window.api.reddit.list(forceRefresh));
  }, []);
  const loadOpenRouter = useCallback(async () => {
    setOpenRouterUsage(await window.api.openrouter.usage(openRouterPeriod));
  }, [openRouterPeriod]);
  const loadOpenAI = useCallback(async () => {
    setOpenAIUsage(await window.api.openai.usage(openAIPeriod));
  }, [openAIPeriod]);
  const loadFirecrawl = useCallback(async () => {
    setFirecrawlUsage(await window.api.firecrawl.usage());
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
    setStatsRefreshKey((key) => key + 1);
    try {
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
        loadCodex(),
        loadProcessStatuses(),
        loadYnab(),
        loadBudgetHealth(),
        loadFinanceReviewLog(),
        loadBills(),
        loadCards(),
        loadOpenRouter(),
        loadOpenAI(),
        loadFirecrawl(),
        loadYouTube(true),
        loadReddit(true),
        loadReaderFeed(readerFeedPage, readerFeedSource, true),
        loadGithubReleases(true),
      ]);
      setLastRefreshedAt(new Date());
    } finally {
      setRefreshing(false);
    }
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
    loadCodex,
    loadProcessStatuses,
    loadYnab,
    loadBudgetHealth,
    loadFinanceReviewLog,
    loadBills,
    loadCards,
    loadOpenRouter,
    loadOpenAI,
    loadFirecrawl,
    loadYouTube,
    loadReddit,
    loadReaderFeed,
    readerFeedPage,
    readerFeedSource,
    loadGithubReleases,
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

  useEffect(() => {
    let cancelled = false;
    void window.api.settings.getAll().then((cfg) => {
      if (cancelled) return;
      setAppRefreshMinutes(cfg.app?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES);
      setDockerRefreshSeconds(cfg.docker?.refreshSeconds || DEFAULT_DOCKER_REFRESH_SECONDS);
      setDockerUpdateChecksEnabled(cfg.docker?.updateChecksEnabled !== false);
      setDockerUpdateCheckMinutes(cfg.docker?.updateCheckMinutes || DEFAULT_DOCKER_UPDATE_CHECK_MINUTES);
      setStatsRefreshSeconds(cfg.stats?.refreshSeconds || DEFAULT_STATS_REFRESH_SECONDS);
      setStatsPublicIpEnabled(cfg.stats?.publicIpEnabled !== false);
      setStatsPublicIpCheckMinutes(cfg.stats?.publicIpCheckMinutes || DEFAULT_STATS_PUBLIC_IP_CHECK_MINUTES);
      setBackgroundNetwork(cfg.stats?.backgroundNetwork === true);
      setSpotifyEnabled(cfg.spotify?.enabled !== false);
      setGithubRefreshSeconds(cfg.github?.refreshSeconds || DEFAULT_GITHUB_REFRESH_SECONDS);
      setYnabRefreshSeconds(cfg.ynab?.refreshSeconds || DEFAULT_YNAB_REFRESH_SECONDS);
      setOpenRouterRefreshSeconds(cfg.openrouter?.refreshSeconds || DEFAULT_OPENROUTER_REFRESH_SECONDS);
      setOpenAIRefreshSeconds(cfg.openai?.refreshSeconds || DEFAULT_OPENAI_REFRESH_SECONDS);
      setFirecrawlRefreshSeconds(cfg.firecrawl?.refreshSeconds || DEFAULT_FIRECRAWL_REFRESH_SECONDS);
      setGitRefreshSeconds(cfg.git?.refreshSeconds || DEFAULT_GIT_REFRESH_SECONDS);
      setNotificationSettings(cfg.notifications ?? {});
      setShowTimeTracking(cfg.todoist?.showTimeTracking !== false);
      setProcessConfigs(cfg.processes ?? []);
      if (cfg.tabs?.length) setTabOrder(cfg.tabs);
      setSettingsLoaded(true);
    }).catch(() => { if (!cancelled) setSettingsLoaded(true); });
    void Promise.all([
      window.api.links.list("localApps").then(setLocalApps),
      window.api.links.list("learning").then(setLearning),
      window.api.links.list("claudeCode").then(setClaudeProjects),
      window.api.links.list("fileLinks").then(setFileLinks),
    ]);
    return () => { cancelled = true; };
  }, []);

  const foreground = settingsLoaded && windowVisible;
  const appInterval = Math.max(1, appRefreshMinutes) * 60_000;
  // Zero disables automatic refresh but still permits first load on tab entry.
  const localInterval = appRefreshMinutes > 0 ? appInterval : 2_147_483_647;
  // These four background checks feed notifications and the tray.
  usePolling(loadDocker, dockerRefreshSeconds * 1000, settingsLoaded, 100);
  usePolling(loadGithub, githubRefreshSeconds * 1000, settingsLoaded, 600);
  usePolling(loadProcessStatuses, 3000, settingsLoaded, 200);
  usePolling(loadBudgetHealth, ynabRefreshSeconds * 1000, settingsLoaded, 1200);
  usePolling(loadYnab, ynabRefreshSeconds * 1000, foreground && activeTab === "finances", 300);
  usePolling(loadDockerUpdates, dockerUpdateCheckMinutes * 60_000, foreground && activeTab === "development" && dockerUpdateChecksEnabled, 2000);
  usePolling(loadGit, gitRefreshSeconds * 1000, foreground && activeTab === "development", 300);
  usePolling(loadNowPlaying, 4000, foreground && spotifyEnabled, 400);
  useEffect(() => { if (!spotifyEnabled) setNowPlaying(null); }, [spotifyEnabled]);
  usePolling(loadOpenRouter, openRouterRefreshSeconds * 1000, foreground && activeTab === "ai" && aiSubTab === "openrouter", 0, openRouterPeriod);
  usePolling(loadOpenAI, openAIRefreshSeconds * 1000, foreground && activeTab === "ai" && aiSubTab === "openai", 100, openAIPeriod);
  usePolling(loadFirecrawl, firecrawlRefreshSeconds * 1000, foreground && activeTab === "ai" && aiSubTab === "firecrawl", 50);
  usePolling(loadCodex, localInterval, foreground && activeTab === "ai" && aiSubTab === "openai");
  usePolling(loadClaude, localInterval, foreground && activeTab === "ai" && aiSubTab === "claude");
  usePolling(async () => { await Promise.all([loadDaily(), loadMissions(), loadTodoist(), loadCalendar()]); setLastRefreshedAt(new Date()); }, localInterval, foreground && activeTab === "home", 0);
  usePolling(() => loadReader(readerPage), localInterval, foreground && activeTab === "reader" && readerSubTab === "saved");
  usePolling(
    () => loadReaderFeed(readerFeedPage, readerFeedSource),
    localInterval,
    foreground && activeTab === "reader" && readerSubTab === "feed",
    0,
    readerFeedSource
  );
  usePolling(loadGithubReleases, localInterval, foreground && activeTab === "development", 800);
  usePolling(async () => { await Promise.all([loadYouTube(), loadReddit()]); }, localInterval, foreground && activeTab === "social", 400);
  usePolling(async () => { await Promise.all([loadFinanceReviewLog(), loadBills(), loadCards()]); }, localInterval, foreground && activeTab === "finances");

  // ---- alerts + tray, derived from state the widgets already poll ----
  // No new polling: this reacts to github/processStatuses/docker changing,
  // each of which has its own interval elsewhere in this file.
  useEffect(() => {
    const next = buildSnapshot(github, processStatuses, docker, budgetHealth);
    for (const alert of diffAlerts(prevSnapshot.current, next, notificationSettings, processConfigs)) {
      void window.api.notifications.show(alert);
    }
    prevSnapshot.current = next;
    void window.api.tray.update(summarize(next));
  }, [github, processStatuses, docker, budgetHealth, notificationSettings, processConfigs]);

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

  // ---- clock / stardate ----
  useEffect(() => {
    const id = setInterval(() => setClock(tickClock()), 1000 * 30);
    return () => clearInterval(id);
  }, []);


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
          <div className="slot slot-git">
            <GitStatusWidget data={gitStatus} />
          </div>
          <div className="slot slot-github">
            <GitHubWidget data={github} />
          </div>
          <div className="slot slot-services">
            <DockerWidget
              data={docker}
              updates={dockerUpdates}
              onRefresh={loadDocker}
              onCheckUpdatesNow={loadDockerUpdates}
            />
          </div>
          <div className="slot slot-claude">
            <ClaudeLauncherWidget
              kind="claudeCode"
              projects={claudeProjects}
              onChange={setClaudeProjects}
            />
          </div>
          <div className="slot slot-releases">
            <GitHubReleasesWidget data={githubReleases} />
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
        <>
          <div className="ai-subtabs" role="tablist" aria-label="Reader view">
            {([
              { id: "saved", label: "Saved" },
              { id: "feed", label: "Feed" },
            ] as { id: ReaderSubTab; label: string }[]).map((sub) => (
              <button
                key={sub.id}
                type="button"
                role="tab"
                aria-selected={readerSubTab === sub.id}
                className={`ai-subtab ${readerSubTab === sub.id ? "active" : ""}`}
                onClick={() => setReaderSubTab(sub.id)}
              >
                {sub.label}
              </button>
            ))}
          </div>
          {readerSubTab === "saved" && (
            <main className="grid grid-reader">
              <div className="slot slot-reader">
                <ReaderWidget data={reader} onNavigate={(page) => loadReader(page)} onChange={setReader} />
              </div>
            </main>
          )}
          {readerSubTab === "feed" && (
            <main className="grid grid-reader">
              <div className="slot slot-reader">
                <ReaderFeedWidget
                  data={readerFeed}
                  source={readerFeedSource}
                  onNavigate={(page) => loadReaderFeed(page, readerFeedSource)}
                  onSource={(src) => loadReaderFeed(0, src)}
                  onChange={setReaderFeed}
                />
              </div>
            </main>
          )}
        </>
      )}

      {activeTab === "social" && (
        <main className="grid grid-social">
          <div className="slot slot-youtube">
            <YouTubeWidget data={youtube} />
          </div>
          <div className="slot slot-reddit">
            <RedditWidget data={reddit} />
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
          <div className="slot slot-ynab-financelog">
            <FinanceReviewLogWidget data={financeReviewLog} onChange={setFinanceReviewLog} />
          </div>
          <div className="slot slot-ynab-accounts">
            <YnabAccountsWidget
              accountsData={ynabAccounts}
              scheduledData={ynabScheduled}
              onChange={setYnabAccounts}
            />
          </div>
          <div className="slot slot-ynab-bills">
            <BillsWidget
              bills={bills}
              onChange={setBills}
              cards={cards}
              onCardsChange={setCards}
              ynabAccounts={ynabAccounts}
            />
          </div>
          <div className="slot slot-ynab-unapproved">
            <YnabUnapprovedWidget
              data={ynabUnapproved}
              categories={ynabCategories}
              payees={ynabPayees}
              accounts={ynabAccounts}
              onRefresh={loadYnabUnapproved}
            />
          </div>
          <div className="slot slot-ynab-budgethealth">
            <BudgetHealthWidget data={budgetHealth} />
          </div>
        </main>
      )}

      {activeTab === "ai" && (
        <>
          <div className="ai-subtabs" role="tablist" aria-label="AI provider">
            {(
              [
                { id: "claude", label: "Claude" },
                { id: "firecrawl", label: "Firecrawl" },
                { id: "openrouter", label: "OpenRouter" },
                { id: "openai", label: "OpenAI" },
              ] as { id: AiSubTab; label: string }[]
            ).map((sub) => (
              <button
                key={sub.id}
                type="button"
                role="tab"
                aria-selected={aiSubTab === sub.id}
                className={`ai-subtab ${aiSubTab === sub.id ? "active" : ""}`}
                onClick={() => setAiSubTab(sub.id)}
              >
                {sub.label}
              </button>
            ))}
          </div>

          {aiSubTab === "claude" && (
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

          {aiSubTab === "firecrawl" && (
            <main className="grid grid-firecrawl">
              <div className="slot slot-firecrawl-usage">
                <FirecrawlUsageWidget data={firecrawlUsage} />
              </div>
              <div className="slot slot-firecrawl-keys">
                <FirecrawlBreakdown
                  title="By API key this period"
                  rows={firecrawlUsage?.byKey ?? []}
                  emptyLabel="No per-key usage this period."
                />
              </div>
            </main>
          )}

          {aiSubTab === "openrouter" && (
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

          {aiSubTab === "openai" && (
            <main className="grid grid-openai">
              <div className="slot slot-codex-summary">
                <CodexUsageWidget data={codexUsage} />
              </div>
              <div className="slot slot-codex-projects">
                <CodexBreakdown
                  title="Codex by project (30d)"
                  rows={codexUsage?.byProject ?? []}
                  emptyLabel="No local Codex usage in the last 30 days."
                />
              </div>
              <div className="slot slot-codex-models">
                <CodexBreakdown
                  title="Codex by model (30d)"
                  rows={codexUsage?.byModel ?? []}
                  emptyLabel="No local Codex usage in the last 30 days."
                />
              </div>
              <div className="slot slot-codex-sessions">
                <CodexSessionsWidget data={codexSessions} />
              </div>
              <h2 className="slot openai-api-heading">OpenAI API</h2>
              <div className="slot slot-openai-summary">
                <OpenAIUsageWidget
                  data={openAIUsage}
                  period={openAIPeriod}
                  onPeriodChange={setOpenAIPeriod}
                />
              </div>
              <div className="slot slot-openai-models">
                <OpenAIModelBreakdown
                  title="API by model"
                  rows={openAIUsage?.byModel ?? []}
                  emptyLabel="No usage in this period."
                />
              </div>
              <div className="slot slot-openai-lineitems">
                <OpenAICostBreakdown
                  title="API by line item"
                  rows={openAIUsage?.byLineItem ?? []}
                  emptyLabel="No cost in this period."
                />
              </div>
            </main>
          )}
        </>
      )}

      <StatsPanel visible={windowVisible && activeTab === "stats"}
        refreshSeconds={statsRefreshSeconds} publicIpEnabled={statsPublicIpEnabled}
        publicIpMinutes={statsPublicIpCheckMinutes} backgroundNetwork={backgroundNetwork}
        refreshKey={statsRefreshKey} />

      <NowPlayingBanner data={nowPlaying} />

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
        onDockerUpdateSettingsChange={(settings) => {
          setDockerUpdateChecksEnabled(settings.updateChecksEnabled !== false);
          setDockerUpdateCheckMinutes(
            settings.updateCheckMinutes || DEFAULT_DOCKER_UPDATE_CHECK_MINUTES
          );
        }}
        onStatsSettingsChange={(settings: StatsSettings) => {
          setBackgroundNetwork(settings.backgroundNetwork === true);
          setStatsRefreshSeconds(settings.refreshSeconds || DEFAULT_STATS_REFRESH_SECONDS);
          setStatsPublicIpEnabled(settings.publicIpEnabled !== false);
          setStatsPublicIpCheckMinutes(
            settings.publicIpCheckMinutes || DEFAULT_STATS_PUBLIC_IP_CHECK_MINUTES
          );
        }}
        onSpotifyEnabledChange={setSpotifyEnabled}
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
        onOpenAIRefreshSecondsChange={(seconds) =>
          setOpenAIRefreshSeconds(seconds ?? DEFAULT_OPENAI_REFRESH_SECONDS)
        }
        onFirecrawlRefreshSecondsChange={(seconds) =>
          setFirecrawlRefreshSeconds(seconds ?? DEFAULT_FIRECRAWL_REFRESH_SECONDS)
        }
      />
    </>
  );
}
