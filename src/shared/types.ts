// Shared contract between main (services + IPC), preload (the bridge), and
// the renderer (React components). This is what makes `window.api` typed.

export interface GrimoireConfig {
  vaultPath: string;
  dailyLogDir: string;
  missionsDir: string;
  // Vault-relative path to the template seeded into a daily note that doesn't
  // exist yet, e.g. "_System/templates/sanctum/daily template.md". Empty or
  // unset means a new note starts blank.
  dailyTemplatePath?: string;
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

// One tracked repository, remote and/or local. A row serves whichever roles
// its fields fill in: owner+repo puts it in the GitHub widget (CI + PRs),
// localPath puts it in the Git widget (working-tree status), both puts it in
// both. That's why owner/repo are optional — a local-only scratch repo with
// no GitHub counterpart is still worth watching for uncommitted work.
export interface GitHubRepoConfig {
  id: number;
  label: string;
  owner?: string;
  repo?: string;
  branch: string;
  localPath?: string;
  sortOrder: number;
}

// What the Settings form supplies on add/update. An object rather than
// positional args (matching ProcessConfig's CRUD) because most of the fields
// are optional now and a positional list of maybe-undefined strings is easy
// to get subtly wrong at a call site.
export type GitHubRepoInput = Omit<GitHubRepoConfig, "id" | "sortOrder">;

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

// `managementApiKey` is a Management/Provisioning API key from OpenRouter's
// dashboard — a credential distinct from a normal inference key, and unable
// to make completion calls. It's required for every endpoint this feature
// uses (credits, keys, activity); a regular inference key can't answer any
// of them. See services/openrouter.ts.
export interface OpenRouterScalarConfig {
  managementApiKey?: string;
  refreshSeconds?: number;
}

// `adminApiKey` is an Admin API key from OpenAI's organization settings
// (Settings → Organization → Admin keys) — a credential distinct from a
// normal project API key, scoped to administrative endpoints only. It's
// required for both endpoints this feature uses (organization usage,
// organization costs); a regular project key can't call either. Unlike
// OpenRouter, OpenAI's API has no endpoint for remaining credit balance, so
// there's no `creditBalance` counterpart here. See services/openai.ts.
export interface OpenAIScalarConfig {
  adminApiKey?: string;
  refreshSeconds?: number;
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

// Display order + label for one of the app's fixed top-level tabs (Home,
// Development, ...). `id` matches the renderer's TabId union — this table
// only ever reorders/relabels the existing fixed set, it doesn't add or
// remove tabs, so there's no add/remove CRUD to go with list/rename/reorder.
export interface TabConfig {
  id: string;
  label: string;
  sortOrder: number;
}

export interface AppConfig {
  grimoire: GrimoireConfig;
  docker: { refreshSeconds: number };
  app?: { refreshMinutes?: number };
  todoist: { apiToken: string; showTimeTracking?: boolean };
  googleCalendar: GoogleCalendarConfig;
  reader: { apiToken: string };
  github?: GitHubConfig;
  git?: { refreshSeconds?: number };
  notifications?: NotificationSettings;
  backup?: BackupSettings;
  capture?: CaptureSettings;
  vaults?: VaultConfig[];
  processes?: ProcessConfig[];
  ynab?: YnabScalarConfig;
  openrouter?: OpenRouterScalarConfig;
  openai?: OpenAIScalarConfig;
  tabs?: TabConfig[];
  spotify?: { enabled: boolean };
}

export type ContainerState = "running" | "exited" | "created" | "paused" | string;

export interface DockerContainer {
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  ports: string;
}

// Read directly from the local Spotify.app via AppleScript — no Spotify Web
// API, no OAuth. artworkUrl may be absent even while playing: local files not
// synced to Spotify's CDN don't have one.
export interface SpotifyNowPlayingResult {
  ok: boolean;
  reason?: string;
  playing: boolean;
  track?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
}

export interface DockerResult {
  ok: boolean;
  reason?: string;
  containers: DockerContainer[];
}

// Persisted window geometry. Main-process only — deliberately absent from
// AppConfig and the preload API, since the renderer has no business with it.
export interface WindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // Distinct states on macOS: the green title-bar button enters *fullscreen*,
  // while maximize is the option-click (and the usual meaning elsewhere).
  maximized?: boolean;
  fullscreen?: boolean;
}

// Token counts split the way Claude Code's transcripts record them. The two
// cache-write buckets are separate because they're priced differently (5-minute
// TTL is 1.25x the input rate, 1-hour is 2x), and the 1-hour bucket dominates
// in practice — collapsing them would materially skew cost.
export interface ClaudeTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface ClaudeUsageWindow {
  costUsd: number;
  requests: number;
  tokens: ClaudeTokenTotals;
}

// One row of a by-project or by-model breakdown. `unpriced` marks a model we
// have no rate for: its tokens are still counted and shown, but its cost is
// excluded rather than silently counted as $0.
export interface ClaudeUsageBucket {
  key: string;
  label: string;
  costUsd: number;
  requests: number;
  tokens: ClaudeTokenTotals;
  unpriced?: boolean;
}

export interface ClaudeUsageDay {
  date: string;
  costUsd: number;
}

export interface ClaudeUsageResult {
  ok: boolean;
  reason?: string;
  // The signed-in plan, used only to express API-equivalent usage as a
  // multiple of the subscription price. `monthlyUsd` is absent for a plan we
  // don't have a price for — in which case no multiple is shown.
  plan?: { label: string; monthlyUsd?: number };
  today: ClaudeUsageWindow;
  last7: ClaudeUsageWindow;
  last30: ClaudeUsageWindow;
  days: ClaudeUsageDay[];
  byProject: ClaudeUsageBucket[];
  byModel: ClaudeUsageBucket[];
  unpricedModels: string[];
  scanMs: number;
}

// Codex records cached input as a subset of input and reasoning output as a
// subset of output. Consumers must use input + output for a true total rather
// than adding all five fields together.
export interface CodexTokenTotals {
  input: number;
  cachedInput: number;
  cacheWriteInput: number;
  output: number;
  reasoningOutput: number;
}

export interface CodexUsageWindow {
  requests: number;
  tokens: CodexTokenTotals;
}

export interface CodexUsageBucket extends CodexUsageWindow {
  key: string;
  label: string;
}

export interface CodexUsageDay {
  date: string;
  tokens: number;
}

export interface CodexQuotaWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number;
  stale: boolean;
}

export interface CodexQuotaSnapshot {
  reportedAt: number;
  planType?: string;
  primary?: CodexQuotaWindow;
  secondary?: CodexQuotaWindow;
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string;
  };
  rateLimitReachedType?: string;
  spendControlReached?: boolean;
}

export interface CodexUsageResult {
  ok: boolean;
  reason?: string;
  today: CodexUsageWindow;
  last7: CodexUsageWindow;
  last30: CodexUsageWindow;
  days: CodexUsageDay[];
  byProject: CodexUsageBucket[];
  byModel: CodexUsageBucket[];
  quota?: CodexQuotaSnapshot;
  scanMs: number;
}

export interface CodexSession {
  id: string;
  cwd: string;
  projectLabel: string;
  title: string;
  model?: string;
  reasoningEffort?: string;
  tokensUsed: number;
  updatedAt: number;
}

export interface CodexSessionsResult {
  ok: boolean;
  reason?: string;
  sessions: CodexSession[];
}

// OpenRouter's reporting periods. Capped at 30d deliberately: OpenRouter's
// own /activity endpoint hard-limits history to the last 30 completed UTC
// days — there's no 60d/90d to offer even with pagination.
export type OpenRouterPeriod = "daily" | "weekly" | "30d";

export interface OpenRouterTokenTotals {
  prompt: number;
  completion: number;
  reasoning: number;
}

// One row of a by-model or by-key breakdown.
export interface OpenRouterUsageBucket {
  key: string;
  label: string;
  costUsd: number;
  requests: number;
  tokens: OpenRouterTokenTotals;
}

export interface OpenRouterUsageResult {
  ok: boolean;
  reason?: string;
  period: OpenRouterPeriod;
  // Set only for period "daily": the completed UTC day ("YYYY-MM-DD") these
  // numbers actually cover. "daily" is pinned to the most recent day OpenRouter
  // has data for, not the caller's local calendar date — see services/openrouter.ts
  // — so the UI shows this rather than assuming it means "today".
  date?: string;
  costUsd: number;
  requests: number;
  tokens: OpenRouterTokenTotals;
  byModel: OpenRouterUsageBucket[];
  byKey: OpenRouterUsageBucket[];
  // Absent when the credits endpoint itself failed even though activity
  // succeeded — kept optional rather than folding into `ok` so a partial
  // result still shows usage even if the balance call had trouble.
  creditBalance?: { totalCredits: number; totalUsage: number; remaining: number };
  scanMs: number;
}

// OpenAI org-level usage/cost periods. Same shape as OpenRouterPeriod, but
// OpenAI's usage endpoint reports the current (incomplete) day in real time,
// so "daily" here just means "today (UTC)" — none of OpenRouterPeriod's
// most-recent-completed-day pinning is needed. See services/openai.ts.
export type OpenAIPeriod = "daily" | "weekly" | "30d";

export interface OpenAITokenTotals {
  // Already includes cached + cache-write tokens, per OpenAI's own field
  // description — `cached` below is a subset of this, not additional.
  input: number;
  cached: number;
  output: number;
}

// One row of the by-model usage breakdown. Tokens/requests only: OpenAI's
// costs endpoint can only be grouped by line item, project, or API key —
// never by model — so cost can't join this table. See services/openai.ts.
export interface OpenAIUsageBucket {
  key: string;
  label: string;
  requests: number;
  tokens: OpenAITokenTotals;
}

// One row of the by-line-item cost breakdown. Line items are OpenAI's own
// cost categories (usually a model name, sometimes a product like "Realtime
// API") — cost-only, since the costs endpoint carries no token counts.
export interface OpenAICostBucket {
  key: string;
  label: string;
  costUsd: number;
}

export interface OpenAIUsageResult {
  ok: boolean;
  reason?: string;
  period: OpenAIPeriod;
  costUsd: number;
  requests: number;
  tokens: OpenAITokenTotals;
  byModel: OpenAIUsageBucket[];
  byLineItem: OpenAICostBucket[];
  scanMs: number;
}

// A resumable Claude Code session. `id` is the transcript's filename, which is
// exactly what `claude -r <id>` takes.
export interface ClaudeSession {
  id: string;
  cwd: string;
  projectLabel: string;
  title?: string;
  lastPrompt?: string;
  updatedAt: number;
  requests: number;
  costUsd: number;
}

export interface ClaudeSessionsResult {
  ok: boolean;
  reason?: string;
  sessions: ClaudeSession[];
}

export interface BackupFile {
  path: string;
  name: string;
  size: number;
  createdAt: number;
}

export interface BackupSettings {
  enabled?: boolean;
  keep?: number;
}

// `canceled` distinguishes "the user dismissed the save dialog" from a real
// failure — the UI must not show an error for it.
export interface ExportResult extends ActionResult {
  canceled?: boolean;
  path?: string;
}

// Where a quick-capture line goes. Todoist is deliberately not a target.
export type CaptureTarget = "dailyNote" | "scratchpad";

export interface CaptureSettings {
  accelerator?: string;
  lastTarget?: CaptureTarget;
}

// `registered` is globalShortcut.register()'s return value, kept because it
// returns false (rather than throwing) when another app already owns the
// combo — a silent no-op otherwise.
export interface CaptureHotkeyStatus {
  accelerator: string;
  registered: boolean;
}

export type AlertKind = "ci" | "process" | "docker" | "overspend";

// One thing worth interrupting the user about. Produced by the renderer's
// pure transition detector (renderer/src/lib/alerts.ts) and handed to main to
// become an OS notification. `key` is the stable identity of the *thing* that
// changed (repo label / process id / container name), not of the event.
export interface AppAlert {
  kind: AlertKind;
  key: string;
  title: string;
  body: string;
  tab?: string;
}

// What the tray renders, pushed up from the renderer whenever the underlying
// widget state changes. Counts, not lists — the tray shows a tally and the
// window shows detail.
export interface TraySummary {
  ciFailures: number;
  processesDown: number;
  containersExited: number;
}

export interface NotificationSettings {
  enabled?: boolean;
  ciFailure?: boolean;
  processCrash?: boolean;
  dockerExit?: boolean;
  overspending?: boolean;
}

// Whether the OS will actually display notifications. `supported` is
// Electron's static check; `lastFailure` is set when a notification we
// actually tried to show emitted `failed` — the difference between "this
// platform can't" and "macOS refused this one".
export interface NotificationHealth {
  supported: boolean;
  lastFailure?: string;
}

// The one main→renderer message shape. Everything else in this app is
// renderer→main invoke; this exists because the tray and notification clicks
// originate in main and need to drive the UI.
export type AppCommand =
  | { type: "refreshAll" }
  | { type: "openTab"; tab: string }
  // Quick capture wrote to `target` behind the UI's back; the owning widget
  // must drop its stale buffer and reload rather than save over it.
  | { type: "captured"; target: CaptureTarget };

// Working-tree state for one configured repo with a localPath. Each row
// carries its own `ok`/`reason` — a bad path or a directory that isn't a repo
// shouldn't blank the whole widget, same per-item fail-soft shape the rest of
// the services use.
export interface GitRepoStatus {
  id: number;
  label: string;
  // Absent for a local-only repo with no GitHub counterpart — see
  // GitHubRepoConfig.owner. Carried through so the widget can group rows by
  // owner the same way GitHubWidget does.
  owner?: string;
  path: string;
  ok: boolean;
  reason?: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  lastCommit?: { hash: string; subject: string; relative: string };
}

// `reason` here is only for a global failure (no git binary at all); a repo
// that individually failed reports it on its own row instead.
export interface GitStatusResult {
  ok: boolean;
  reason?: string;
  repos: GitRepoStatus[];
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
  // The rendered daily template for this date, when the note doesn't exist
  // yet and one is configured. Deliberately NOT folded into `content`: the
  // editor must stay empty until the note is really created, or a file that
  // isn't there looks exactly like one that is.
  templateContent?: string;
  // true when the only thing wrong is that this day's file doesn't exist yet
  // — the vault and daily-log folder are both fine. The widget treats that as
  // an empty, editable note (saveDailyNote creates the file on first write)
  // rather than a dead end, so you don't have to go to Obsidian just to start
  // today's log. A genuine failure (bad vault path, unreadable folder) leaves
  // this false and still shows the reason.
  missing?: boolean;
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
  deadline: string | null;
  project: string;
  projectId: string;
  labels: string[];
  subtasks: TodoistSubtask[];
  parentName: string | null;
}

export interface TodoistProject {
  id: string;
  name: string;
}

export interface TodoistResult {
  ok: boolean;
  reason?: string;
  tasks: TodoistTask[];
  projects: TodoistProject[];
}

// A completed span of tracked time against one Todoist task. task_content/
// project_name are snapshotted at log time (see services/timeTracking.ts) so
// a monthly billing report still reads correctly after the task is completed
// or deleted in Todoist. `source` distinguishes a stopped live timer from a
// manually-logged chunk; both count identically toward totals.
export interface TimeEntry {
  id: number;
  taskId: string;
  taskContent: string;
  projectName: string;
  startedAt: number; // epoch ms
  durationSeconds: number;
  source: "timer" | "manual";
}

// Cumulative time for one task, plus whether it's the task currently
// running — `runningSince` lets the UI compute a live-ticking elapsed
// display without polling every second.
export interface TaskTimeSummary {
  taskId: string;
  totalSeconds: number;
  runningSince: number | null;
}

export interface ActiveTimer {
  taskId: string;
  taskContent: string;
  projectName: string;
  startedAt: number;
}

export interface MonthlyReportTaskEntry {
  taskId: string;
  taskContent: string;
  totalSeconds: number;
}

export interface MonthlyReportProjectGroup {
  projectName: string;
  totalSeconds: number;
  tasks: MonthlyReportTaskEntry[];
}

export interface MonthlyReportResult {
  month: string; // "YYYY-MM"
  totalSeconds: number;
  projects: MonthlyReportProjectGroup[];
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
export type HabitCompletionStatus = "done" | "skipped";

export interface Habit {
  id: number;
  name: string;
  frequencyType: HabitFrequencyType;
  targetCount: number;
  sortOrder: number;
  createdAt: number;
  archived: boolean;
  category: string | null;
}

export interface HabitWeekDay {
  date: string;
  label: string;
}

export interface HabitWeekEntry {
  habit: Habit;
  completions: Record<string, HabitCompletionStatus | undefined>;
  notes: Record<string, string>;
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

export interface HabitStreak {
  habitId: number;
  current: number;
  longest: number;
}

export interface HabitHeatmapDay {
  date: string;
  status: HabitCompletionStatus | null;
}

export interface HabitHeatmapResult {
  habit: Habit;
  days: HabitHeatmapDay[];
  totalDone: number;
  totalSkipped: number;
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
  // Deep link to the transaction's account register in the YNAB web app —
  // YNAB's API doesn't expose a documented per-transaction URL, so this
  // lands on the account rather than scrolled/highlighted to the row.
  ynabUrl: string;
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

// A payee YNAB already knows about — surfaced so the new-transaction form can
// offer autocomplete instead of always minting a new payee from free text.
// Transfer payees (moves between YNAB accounts) are filtered out server-side:
// picking one wouldn't do what a normal payee pick does.
export interface YnabPayee {
  id: string;
  name: string;
}

export interface YnabPayeesResult {
  ok: boolean;
  reason?: string;
  payees: YnabPayee[];
}

// A single assignable category's numbers for the current budget month —
// mirrors YnabCategory's own hidden/deleted/internal filtering (getCategories
// is reused as the allowlist) so the two never drift on what counts as a
// real category.
export interface YnabMonthCategory {
  id: string;
  name: string;
  groupName: string;
  budgeted: number;
  activity: number;
  balance: number;
}

export interface YnabMonthResult {
  ok: boolean;
  reason?: string;
  toBeBudgeted: number;
  // Day count, not a dollar figure — null early in a budget's life before
  // YNAB has enough history to compute it.
  ageOfMoney: number | null;
  categories: YnabMonthCategory[];
}

// A manually-tracked recurring bill — independent of YNAB's own scheduled
// transactions, since not everything recurring is set up as a YNAB
// schedule. dueDay is a plain day-of-month (1-31), not a real date: these
// recur every month with no fixed start/end.
export interface BillItem {
  id: number;
  label: string;
  dueDay: number;
  autopay: boolean;
  note: string | null;
}

// A manually-tracked credit card — shown in the Finances tab's Cards
// sub-tab alongside Bills. creditLimit and apr are plain numbers (dollars,
// percent), not YNAB-sourced.
// ynabAccountId optionally links this card to a real YNAB account for a live
// balance/utilization display — creditLimit and apr stay manually-tracked
// regardless of linking, since YNAB has no concept of either.
export interface CardItem {
  id: number;
  name: string;
  creditLimit: number;
  apr: number;
  ynabAccountId: string | null;
}

// Input for manually adding a transaction — amount is dollars, signed
// (negative = outflow), converted to milliunits server-side. payeeId wins
// over payeeName when a payee was picked from the autocomplete list; a typed
// name with no id falls back to YNAB minting a new payee.
export interface YnabNewTransactionInput {
  accountId: string;
  date: string;
  amount: number;
  payeeName?: string;
  payeeId?: string;
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
  // Last-modified time of the file this content came from, used as the
  // baseline for the compare-before-write in saveNoteFile. Absent for the
  // grimoire readers, which aren't mtime-guarded.
  mtimeMs?: number;
}

// saveNoteFile's result. Carries the post-write mtime so the renderer can
// move its baseline forward — without it, the *next* autosave would compare
// against a stale value and report a conflict on every keystroke burst.
export interface NoteSaveResult {
  ok: boolean;
  reason?: string;
  // true when the write was refused because the file changed underneath us
  // (edited in Obsidian, say). Distinct from a plain failure: nothing was
  // written and the caller can offer to reload or overwrite.
  conflict?: boolean;
  mtimeMs?: number;
}

export interface NoteStatEntry {
  vaultLabel: string;
  filePath: string;
  // null when the file no longer exists or can't be statted.
  mtimeMs: number | null;
}

export interface NoteStatResult {
  ok: boolean;
  reason?: string;
  entries: NoteStatEntry[];
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
  spotify: {
    nowPlaying: () => Promise<SpotifyNowPlayingResult>;
  };
  grimoire: {
    dailyNote: (date?: string) => Promise<DailyNoteResult>;
    saveDailyNote: (date: string, content: string) => Promise<ActionResult>;
    missions: () => Promise<MissionsResult>;
    financeReviewLog: () => Promise<NoteContent>;
    saveFinanceReviewLog: (content: string) => Promise<ActionResult>;
  };
  todoist: {
    tasks: () => Promise<TodoistResult>;
    complete: (taskId: string) => Promise<ActionResult>;
    create: (content: string, projectId?: string) => Promise<ActionResult>;
    // date is an ISO "YYYY-MM-DD" to set it, or null to clear it entirely.
    setDueDate: (taskId: string, date: string | null) => Promise<ActionResult>;
    move: (taskId: string, projectId: string) => Promise<ActionResult>;
  };
  timeTracking: {
    activeTimer: () => Promise<ActiveTimer | null>;
    summaries: (taskIds: string[]) => Promise<Record<string, TaskTimeSummary>>;
    start: (taskId: string, taskContent: string, projectName: string) => Promise<ActiveTimer>;
    stop: () => Promise<void>;
    addManual: (
      taskId: string,
      taskContent: string,
      projectName: string,
      minutes: number,
      date?: string
    ) => Promise<TaskTimeSummary>;
    entries: (taskId: string) => Promise<TimeEntry[]>;
    deleteEntry: (entryId: number, taskId: string) => Promise<TaskTimeSummary>;
    monthlyReport: (month: string) => Promise<MonthlyReportResult>;
  };
  openUrl: (url: string) => Promise<boolean>;
  claude: {
    launch: (projectPath: string) => Promise<ActionResult>;
    usage: () => Promise<ClaudeUsageResult>;
    sessions: (limit?: number) => Promise<ClaudeSessionsResult>;
    resume: (sessionId: string, cwd: string) => Promise<ActionResult>;
  };
  codex: {
    usage: () => Promise<CodexUsageResult>;
    sessions: (limit?: number) => Promise<CodexSessionsResult>;
    resume: (sessionId: string, cwd: string) => Promise<ActionResult>;
  };
  forklift: {
    open: (dirPath: string) => Promise<ActionResult>;
  };
  cursor: {
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
    list: (includeArchived?: boolean) => Promise<Habit[]>;
    add: (
      name: string,
      frequencyType: HabitFrequencyType,
      targetCount?: number,
      category?: string | null
    ) => Promise<Habit[]>;
    update: (
      id: number,
      name: string,
      frequencyType: HabitFrequencyType,
      targetCount?: number,
      category?: string | null
    ) => Promise<Habit[]>;
    remove: (id: number) => Promise<Habit[]>;
    archive: (id: number) => Promise<Habit[]>;
    restore: (id: number) => Promise<Habit[]>;
    reorder: (orderedIds: number[]) => Promise<Habit[]>;
    getWeek: (weekStart?: string) => Promise<HabitWeekView>;
    toggle: (habitId: number, date: string) => Promise<HabitWeekView>;
    setCompletionNote: (habitId: number, date: string, note: string | null) => Promise<HabitWeekView>;
    trends: (habitId?: number, weeks?: number) => Promise<HabitTrendResult | HabitTrendResult[]>;
    streaks: (habitId?: number) => Promise<HabitStreak | HabitStreak[]>;
    categories: () => Promise<string[]>;
    heatmap: (habitId: number, fromDate?: string, toDate?: string) => Promise<HabitHeatmapResult | null>;
  };
  github: {
    status: () => Promise<GitHubStatusResult>;
  };
  git: {
    status: () => Promise<GitStatusResult>;
  };
  openrouter: {
    usage: (period: OpenRouterPeriod) => Promise<OpenRouterUsageResult>;
  };
  openai: {
    usage: (period: OpenAIPeriod) => Promise<OpenAIUsageResult>;
  };
  notifications: {
    show: (alert: AppAlert) => Promise<void>;
    health: () => Promise<NotificationHealth>;
  };
  tray: {
    update: (summary: TraySummary) => Promise<void>;
  };
  backup: {
    export: () => Promise<ExportResult>;
    list: () => Promise<BackupFile[]>;
    runNow: () => Promise<ActionResult>;
  };
  capture: {
    submit: (target: CaptureTarget, text: string) => Promise<ActionResult>;
    cancel: () => Promise<void>;
    hotkeyStatus: () => Promise<CaptureHotkeyStatus>;
  };
  // Returns an unsubscribe. The raw IpcRendererEvent is never passed across
  // the bridge — only the payload.
  onCommand: (cb: (command: AppCommand) => void) => () => void;
  ynab: {
    accounts: () => Promise<YnabAccountsResult>;
    unapprovedTransactions: () => Promise<YnabUnapprovedResult>;
    scheduledTransactions: () => Promise<YnabScheduledResult>;
    categories: () => Promise<YnabCategoriesResult>;
    payees: () => Promise<YnabPayeesResult>;
    currentMonth: () => Promise<YnabMonthResult>;
    approveTransaction: (transactionId: string) => Promise<ActionResult>;
    clearTransaction: (transactionId: string) => Promise<ActionResult>;
    setTransactionCategory: (transactionId: string, categoryId: string) => Promise<ActionResult>;
    setTransactionMemo: (transactionId: string, memo: string) => Promise<ActionResult>;
    createTransaction: (input: YnabNewTransactionInput) => Promise<ActionResult>;
    toggleAccountHidden: (accountId: string) => Promise<YnabAccountsResult>;
  };
  bills: {
    list: () => Promise<BillItem[]>;
    add: (label: string, dueDay: number, autopay: boolean) => Promise<BillItem[]>;
    update: (id: number, label: string, dueDay: number, autopay: boolean) => Promise<BillItem[]>;
    remove: (id: number) => Promise<BillItem[]>;
    setNote: (id: number, note: string) => Promise<BillItem[]>;
  };
  cards: {
    list: () => Promise<CardItem[]>;
    add: (
      name: string,
      creditLimit: number,
      apr: number,
      ynabAccountId: string | null
    ) => Promise<CardItem[]>;
    update: (
      id: number,
      name: string,
      creditLimit: number,
      apr: number,
      ynabAccountId: string | null
    ) => Promise<CardItem[]>;
    remove: (id: number) => Promise<CardItem[]>;
  };
  notes: {
    vaults: () => Promise<VaultConfig[]>;
    browse: (vaultLabel: string, subPath?: string) => Promise<NoteBrowseResult>;
    index: (vaultLabel: string) => Promise<VaultNoteIndexResult>;
    read: (vaultLabel: string, filePath: string) => Promise<NoteContent>;
    // expectedMtimeMs omitted = write unconditionally (first save, or an
    // explicit "overwrite anyway" after a conflict).
    save: (
      vaultLabel: string,
      filePath: string,
      content: string,
      expectedMtimeMs?: number
    ) => Promise<NoteSaveResult>;
    // Batched so checking every open note on window focus costs one IPC
    // round trip rather than one per note.
    statMany: (targets: { vaultLabel: string; filePath: string }[]) => Promise<NoteStatResult>;
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
    spotify: {
      update: (values: { enabled: boolean }) => Promise<{ enabled: boolean }>;
    };
    app: {
      update: (values: { refreshMinutes?: number }) => Promise<{ refreshMinutes?: number }>;
    };
    todoist: {
      update: (values: {
        apiToken: string;
        showTimeTracking?: boolean;
      }) => Promise<{ apiToken: string; showTimeTracking?: boolean }>;
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
    git: {
      update: (values: { refreshSeconds?: number }) => Promise<{ refreshSeconds?: number }>;
    };
    notifications: {
      update: (values: NotificationSettings) => Promise<NotificationSettings>;
    };
    backup: {
      update: (values: BackupSettings) => Promise<BackupSettings>;
    };
    capture: {
      update: (values: CaptureSettings) => Promise<CaptureSettings>;
    };
    ynab: {
      update: (values: YnabScalarConfig) => Promise<YnabScalarConfig>;
    };
    openrouter: {
      update: (values: OpenRouterScalarConfig) => Promise<OpenRouterScalarConfig>;
    };
    openai: {
      update: (values: OpenAIScalarConfig) => Promise<OpenAIScalarConfig>;
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
      add: (repo: GitHubRepoInput) => Promise<GitHubRepoConfig[]>;
      update: (id: number, repo: GitHubRepoInput) => Promise<GitHubRepoConfig[]>;
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
    tabs: {
      rename: (id: string, label: string) => Promise<TabConfig[]>;
      reorder: (orderedIds: string[]) => Promise<TabConfig[]>;
    };
  };
}
