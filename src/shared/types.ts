// Shared contract between main (services + IPC), preload (the bridge), and
// the renderer (React components). This is what makes `window.api` typed.

export interface GrimoireConfig {
  vaultPath: string;
  dailyLogDir: string;
  missionsDir: string;
}

// A quick-launch entry — a SillyTavern instance, a local app, a Claude Code
// project directory, anything with a display name and a link. `link` is a
// URL for Local Apps/Learning and a directory path for Claude Code; each of
// the three lists is its own DB table (see src/main/services/links.ts) but
// shares this shape.
export interface LinkItem {
  id: number;
  label: string;
  link: string;
  sortOrder: number;
}

export type LinkListKind = "localApps" | "learning" | "claudeCode" | "fileLinks";

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
}

export interface GitHubRepoConfig {
  id: number;
  label: string;
  owner: string;
  repo: string;
  branch: string;
  sortOrder: number;
}

// The non-array part of GitHub settings, editable as one scalar section in
// Settings. `repos` is its own DB table/CRUD surface (see GitHubRepoConfig).
export interface GitHubScalarConfig {
  token?: string;
  refreshSeconds?: number;
  reviewUser?: string;
}

// Optional: older config.json files predate this feature and won't have a
// `github` section at all — every reader of this treats it as absent, not
// an error (see services/github.ts).
export interface GitHubConfig extends GitHubScalarConfig {
  repos?: GitHubRepoConfig[];
}

// A labeled Obsidian vault root for the Notes tab. Separate from
// grimoire.vaultPath (the Home tab's daily-note/missions vault) — you can
// point the Notes tab at several vaults, including that same one.
export interface VaultConfig {
  id: number;
  label: string;
  path: string;
  sortOrder: number;
}

// A locally-managed long-running process (dev server, watcher, a tool like
// opencode) that the Development tab can start/stop/tail. `cwd` is optional
// — omit it for tools that don't care where they run; include it for ones
// that do. `url`/`autoOpenUrl`/`openDelayMs` are for a process that serves a
// web UI worth jumping straight to once it's up.
export interface ProcessConfig {
  id: string;
  label: string;
  command: string;
  args?: string[];
  cwd?: string;
  url?: string;
  autoOpenUrl?: boolean;
  openDelayMs?: number;
  sortOrder: number;
}

// Runtime state for one managed process. `logs` is a tail of raw
// stdout/stderr chunks (not pre-split into lines) — the renderer just joins
// and displays them. A process that's never been started this session has
// no status yet; callers treat that the same as `{ running: false,
// exitCode: null, logs: [] }`.
export interface ProcessStatus {
  id: string;
  running: boolean;
  exitCode: number | null;
  logs: string[];
}

export interface AppConfig {
  grimoire: GrimoireConfig;
  docker: { refreshSeconds: number };
  app?: { refreshMinutes?: number };
  todoist: { apiToken: string };
  googleCalendar: GoogleCalendarConfig;
  reader: { apiToken: string };
  github?: GitHubConfig;
  vaults?: VaultConfig[];
  processes?: ProcessConfig[];
  ynab?: YnabScalarConfig;
}

export type ContainerState = "running" | "exited" | "created" | "paused" | string;

export interface DockerContainer {
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  ports: string;
}

export interface DockerResult {
  ok: boolean;
  reason?: string;
  containers: DockerContainer[];
}

export interface DailyNoteResult {
  ok: boolean;
  file: string;
  reason?: string;
  content: string;
  date: string;
  prevDate: string | null;
  nextDate: string | null;
  obsidianUri: string;
}

export interface Mission {
  name: string;
  path: string;
  modified: number;
  obsidianUri: string;
  tags: string[];
}

export interface MissionsResult {
  ok: boolean;
  reason?: string;
  missions: Mission[];
}

export interface TodoistSubtask {
  id: string;
  content: string;
  checked: boolean;
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  url: string;
  priority: number;
  due: string | null;
  overdue: boolean;
  project: string;
  labels: string[];
  subtasks: TodoistSubtask[];
  parentName: string | null;
}

export interface TodoistResult {
  ok: boolean;
  reason?: string;
  tasks: TodoistTask[];
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  meetingUrl: string | null;
  description: string;
  htmlLink: string;
}

export interface CalendarResult {
  ok: boolean;
  reason?: string;
  needsAuth?: boolean;
  events: CalendarEvent[];
  date: string;
}

// Generic result for actions that either succeed or fail with a reason —
// used for launching a terminal, completing a task, creating a task, etc.
export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export interface ReaderDocument {
  id: string;
  title: string;
  author: string;
  url: string; // Reader's own read.readwise.io link — what clicking opens
  category: string;
  savedAt: string;
}

export interface ReaderResult {
  ok: boolean;
  reason?: string;
  documents: ReaderDocument[];
  page: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export type HabitFrequencyType = "daily" | "weekly" | "times_per_week";

export interface Habit {
  id: number;
  name: string;
  frequencyType: HabitFrequencyType;
  targetCount: number;
  sortOrder: number;
  createdAt: number;
}

export interface HabitWeekDay {
  date: string;
  label: string;
}

export interface HabitWeekEntry {
  habit: Habit;
  completions: Record<string, boolean>;
  weekCount: number;
  weekTarget: number;
  goalMet: boolean;
}

export interface HabitWeekView {
  weekStart: string;
  weekEnd: string;
  days: HabitWeekDay[];
  habits: HabitWeekEntry[];
}

export interface HabitTrendWeek {
  weekStart: string;
  weekLabel: string;
  completed: number;
  target: number;
  rate: number;
  goalMet: boolean;
}

export interface HabitTrendResult {
  habit: Habit;
  weeks: HabitTrendWeek[];
}

// GitHub Actions run status for one workflow run, on any branch (not just
// the repo's configured main branch) — so PR-branch runs show up too.
// `conclusion` is null while `status` isn't yet "completed".
export interface CiRun {
  status: string;
  conclusion: string | null;
  workflowName: string;
  url: string;
  updatedAt: string;
  branch: string;
}

export interface GitHubPr {
  number: number;
  title: string;
  author: string;
  url: string;
  repoLabel: string;
}

export interface GitHubRepoStatus {
  label: string;
  owner: string;
  repo: string;
  branch: string;
  ok: boolean;
  reason?: string;
  ci: CiRun | null;
  ciHistory: CiRun[];
  openPrCount: number;
  openPrs: GitHubPr[];
  prsUrl: string;
}

export interface GitHubStatusResult {
  ok: boolean;
  reason?: string;
  repos: GitHubRepoStatus[];
  reviewRequested: GitHubPr[];
  reviewRequestedReason?: string;
}

// The non-array part of YNAB settings. `hiddenAccountIds` is toggled from the
// Accounts widget itself (an eye icon per row), not from the Settings page —
// it lives here as a plain JSON array rather than its own SQL table since
// it's a flag layered onto externally-sourced YNAB account ids, not a
// user-authored list with its own add/reorder UI.
export interface YnabScalarConfig {
  token?: string;
  planId?: string;
  refreshSeconds?: number;
  hiddenAccountIds?: string[];
}

// Closed accounts are filtered out before this ever reaches the renderer —
// `hidden` reflects hiddenAccountIds, computed server-side so the token never
// needs to live in renderer state just to preserve it across a toggle.
export interface YnabAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  hidden: boolean;
}

export interface YnabAccountsResult {
  ok: boolean;
  reason?: string;
  accounts: YnabAccount[];
}

export interface YnabTransaction {
  id: string;
  date: string;
  amount: number;
  payeeName: string | null;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  memo: string | null;
}

export interface YnabUnapprovedResult {
  ok: boolean;
  reason?: string;
  transactions: YnabTransaction[];
}

export interface YnabScheduledTransaction {
  id: string;
  dateNext: string;
  frequency: string;
  amount: number;
  payeeName: string | null;
  accountId: string;
  accountName: string;
  memo: string | null;
}

export interface YnabScheduledResult {
  ok: boolean;
  reason?: string;
  transactions: YnabScheduledTransaction[];
}

// A user-assignable budget category, flattened from YNAB's category_groups.
// Internal/hidden/deleted groups and categories (e.g. "Uncategorized",
// "Inflow: Ready to Assign") are filtered out server-side — every entry here
// is something a transaction can actually be assigned to.
export interface YnabCategory {
  id: string;
  name: string;
  groupName: string;
}

export interface YnabCategoriesResult {
  ok: boolean;
  reason?: string;
  categories: YnabCategory[];
}

// Input for manually adding a transaction — amount is dollars, signed
// (negative = outflow), converted to milliunits server-side.
export interface YnabNewTransactionInput {
  accountId: string;
  date: string;
  amount: number;
  payeeName?: string;
  categoryId?: string;
  memo?: string;
}

// A file or folder one level down from wherever browseVault() was pointed —
// `path` is relative to the vault root, used as-is by subsequent browse/read/
// save calls so the renderer never needs to know the vault's real disk path.
export interface NoteFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface NoteBrowseResult {
  ok: boolean;
  reason?: string;
  folders: NoteFileEntry[];
  files: NoteFileEntry[];
}

export interface NoteContent {
  ok: boolean;
  reason?: string;
  content: string;
}

// Result of creating a new note file — filePath is vault-relative, same
// shape callers already pass to notes.read/save, so a fresh note slots into
// the nav-pin/open flow exactly like picking an existing one.
export interface NoteCreateResult {
  ok: boolean;
  reason?: string;
  filePath: string;
}

// An Obsidian Templater template, listed from a vault's fixed
// _System/templates folder — path is vault-relative, same shape createNote
// expects back.
export interface TemplateEntry {
  name: string;
  path: string;
}

export interface TemplateListResult {
  ok: boolean;
  reason?: string;
  templates: TemplateEntry[];
}

// A note pinned into the Notes tab's left nav. Deleting one only removes
// this row — the file on disk is untouched.
export interface NoteNavItem {
  id: number;
  vaultLabel: string;
  filePath: string;
  label: string;
}

export interface NotesSession {
  openNoteIds: number[];
  activeNoteId: number | null;
}

// A vault-wide index of every note's basename → relative path, used to
// resolve [[wikilinks]] against files that aren't necessarily pinned to the
// Notes tab's nav.
export interface VaultNoteIndexEntry {
  basename: string;
  path: string;
}

export interface VaultNoteIndexResult {
  ok: boolean;
  reason?: string;
  entries: VaultNoteIndexEntry[];
}

export interface CommandCenterApi {
  docker: {
    list: () => Promise<DockerResult>;
    start: (name: string) => Promise<ActionResult>;
    stop: (name: string) => Promise<ActionResult>;
  };
  grimoire: {
    dailyNote: (date?: string) => Promise<DailyNoteResult>;
    saveDailyNote: (date: string, content: string) => Promise<ActionResult>;
    missions: () => Promise<MissionsResult>;
    financeReviewLog: () => Promise<NoteContent>;
  };
  todoist: {
    tasks: () => Promise<TodoistResult>;
    complete: (taskId: string) => Promise<ActionResult>;
    create: (content: string) => Promise<ActionResult>;
  };
  openUrl: (url: string) => Promise<boolean>;
  claude: {
    launch: (projectPath: string) => Promise<ActionResult>;
  };
  forklift: {
    open: (dirPath: string) => Promise<ActionResult>;
  };
  calendar: {
    events: (date?: string) => Promise<CalendarResult>;
    connect: () => Promise<ActionResult>;
  };
  links: {
    list: (kind: LinkListKind) => Promise<LinkItem[]>;
    add: (kind: LinkListKind, label: string, link: string) => Promise<LinkItem[]>;
    update: (kind: LinkListKind, id: number, label: string, link: string) => Promise<LinkItem[]>;
    remove: (kind: LinkListKind, id: number) => Promise<LinkItem[]>;
    reorder: (kind: LinkListKind, orderedIds: number[]) => Promise<LinkItem[]>;
  };
  reader: {
    list: (page: number, forceRefresh?: boolean) => Promise<ReaderResult>;
    archive: (id: string, page: number) => Promise<ReaderResult>;
    delete: (id: string, page: number) => Promise<ReaderResult>;
  };
  scratchpad: {
    get: () => Promise<string>;
    save: (content: string) => Promise<void>;
    clear: () => Promise<void>;
  };
  habits: {
    list: () => Promise<Habit[]>;
    add: (name: string, frequencyType: HabitFrequencyType, targetCount?: number) => Promise<Habit[]>;
    update: (
      id: number,
      name: string,
      frequencyType: HabitFrequencyType,
      targetCount?: number
    ) => Promise<Habit[]>;
    remove: (id: number) => Promise<Habit[]>;
    reorder: (orderedIds: number[]) => Promise<Habit[]>;
    getWeek: (weekStart?: string) => Promise<HabitWeekView>;
    toggle: (habitId: number, date: string) => Promise<HabitWeekView>;
    trends: (habitId?: number, weeks?: number) => Promise<HabitTrendResult | HabitTrendResult[]>;
  };
  github: {
    status: () => Promise<GitHubStatusResult>;
  };
  ynab: {
    accounts: () => Promise<YnabAccountsResult>;
    unapprovedTransactions: () => Promise<YnabUnapprovedResult>;
    scheduledTransactions: () => Promise<YnabScheduledResult>;
    categories: () => Promise<YnabCategoriesResult>;
    approveTransaction: (transactionId: string) => Promise<ActionResult>;
    setTransactionCategory: (transactionId: string, categoryId: string) => Promise<ActionResult>;
    setTransactionMemo: (transactionId: string, memo: string) => Promise<ActionResult>;
    createTransaction: (input: YnabNewTransactionInput) => Promise<ActionResult>;
    toggleAccountHidden: (accountId: string) => Promise<YnabAccountsResult>;
  };
  notes: {
    vaults: () => Promise<VaultConfig[]>;
    browse: (vaultLabel: string, subPath?: string) => Promise<NoteBrowseResult>;
    index: (vaultLabel: string) => Promise<VaultNoteIndexResult>;
    read: (vaultLabel: string, filePath: string) => Promise<NoteContent>;
    save: (vaultLabel: string, filePath: string, content: string) => Promise<ActionResult>;
    create: (
      vaultLabel: string,
      dirPath: string,
      name: string,
      templatePath?: string | null
    ) => Promise<NoteCreateResult>;
    templates: (vaultLabel: string) => Promise<TemplateListResult>;
    nav: {
      list: () => Promise<NoteNavItem[]>;
      add: (vaultLabel: string, filePath: string, label: string) => Promise<NoteNavItem[]>;
      remove: (id: number) => Promise<NoteNavItem[]>;
    };
    session: {
      get: () => Promise<NotesSession>;
      set: (openNoteIds: number[], activeNoteId: number | null) => Promise<NotesSession>;
    };
  };
  process: {
    start: (id: string) => Promise<ActionResult>;
    stop: (id: string) => Promise<ActionResult>;
    status: (id: string) => Promise<ProcessStatus>;
    statusAll: () => Promise<ProcessStatus[]>;
  };
  settings: {
    getAll: () => Promise<AppConfig>;
    grimoire: {
      update: (values: GrimoireConfig) => Promise<GrimoireConfig>;
    };
    docker: {
      update: (values: { refreshSeconds: number }) => Promise<{ refreshSeconds: number }>;
    };
    app: {
      update: (values: { refreshMinutes?: number }) => Promise<{ refreshMinutes?: number }>;
    };
    todoist: {
      update: (values: { apiToken: string }) => Promise<{ apiToken: string }>;
    };
    googleCalendar: {
      update: (values: GoogleCalendarConfig) => Promise<GoogleCalendarConfig>;
    };
    reader: {
      update: (values: { apiToken: string }) => Promise<{ apiToken: string }>;
    };
    github: {
      update: (values: GitHubScalarConfig) => Promise<GitHubScalarConfig>;
    };
    ynab: {
      update: (values: YnabScalarConfig) => Promise<YnabScalarConfig>;
    };
    vaults: {
      list: () => Promise<VaultConfig[]>;
      add: (label: string, path: string) => Promise<VaultConfig[]>;
      update: (id: number, label: string, path: string) => Promise<VaultConfig[]>;
      remove: (id: number) => Promise<VaultConfig[]>;
      reorder: (orderedIds: number[]) => Promise<VaultConfig[]>;
    };
    githubRepos: {
      list: () => Promise<GitHubRepoConfig[]>;
      add: (label: string, owner: string, repo: string, branch: string) => Promise<GitHubRepoConfig[]>;
      update: (
        id: number,
        label: string,
        owner: string,
        repo: string,
        branch: string
      ) => Promise<GitHubRepoConfig[]>;
      remove: (id: number) => Promise<GitHubRepoConfig[]>;
      reorder: (orderedIds: number[]) => Promise<GitHubRepoConfig[]>;
    };
    processes: {
      list: () => Promise<ProcessConfig[]>;
      add: (proc: Omit<ProcessConfig, "sortOrder">) => Promise<ProcessConfig[]>;
      update: (id: string, proc: Omit<ProcessConfig, "id" | "sortOrder">) => Promise<ProcessConfig[]>;
      remove: (id: string) => Promise<ProcessConfig[]>;
      reorder: (orderedIds: string[]) => Promise<ProcessConfig[]>;
    };
  };
}
