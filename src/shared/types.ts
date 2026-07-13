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

export type LinkListKind = "localApps" | "learning" | "claudeCode";

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
}

export interface GitHubRepoConfig {
  label: string;
  owner: string;
  repo: string;
  branch: string;
}

// Optional: older config.json files predate this feature and won't have a
// `github` section at all — every reader of this treats it as absent, not
// an error (see services/github.ts).
export interface GitHubConfig {
  token?: string;
  refreshSeconds?: number;
  reviewUser?: string;
  repos?: GitHubRepoConfig[];
}

export interface AppConfig {
  grimoire: GrimoireConfig;
  docker: { refreshSeconds: number };
  app?: { refreshMinutes?: number };
  todoist: { apiToken: string };
  googleCalendar: GoogleCalendarConfig;
  reader: { apiToken: string };
  github?: GitHubConfig;
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

// GitHub Actions run status for the most recent run on a repo's configured
// branch. `conclusion` is null while `status` isn't yet "completed".
export interface CiRun {
  status: string;
  conclusion: string | null;
  workflowName: string;
  url: string;
  updatedAt: string;
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

export interface CommandCenterApi {
  getConfig: () => Promise<AppConfig>;
  docker: {
    list: () => Promise<DockerResult>;
    start: (name: string) => Promise<ActionResult>;
    stop: (name: string) => Promise<ActionResult>;
  };
  grimoire: {
    dailyNote: (date?: string) => Promise<DailyNoteResult>;
    missions: () => Promise<MissionsResult>;
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
}
