// Shared contract between main (services + IPC), preload (the bridge), and
// the renderer (React components). This is what makes `window.api` typed.

export interface GrimoireConfig {
  vaultPath: string;
  dailyLogDir: string;
  missionsDir: string;
}

// A quick-launch link — a SillyTavern instance, a local app, anything
// reachable by URL. Shared shape so one widget can render any of them.
export interface LinkInstance {
  label: string;
  url: string;
}

export interface ClaudeProject {
  label: string;
  path: string;
}

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
}

export interface AppConfig {
  grimoire: GrimoireConfig;
  localApps: { instances: LinkInstance[] };
  learning: { instances: LinkInstance[] };
  claudeCode: { projects: ClaudeProject[] };
  docker: { refreshSeconds: number };
  todoist: { apiToken: string };
  googleCalendar: GoogleCalendarConfig;
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

export interface CommandCenterApi {
  getConfig: () => Promise<AppConfig>;
  docker: {
    list: () => Promise<DockerResult>;
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
}
