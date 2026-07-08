// Shared contract between main (services + IPC), preload (the bridge), and
// the renderer (React components). This is what makes `window.api` typed.

export interface GrimoireConfig {
  vaultPath: string;
  dailyLogDir: string;
  missionsDir: string;
}

export interface SillyTavernInstance {
  label: string;
  url: string;
}

export interface ClaudeProject {
  label: string;
  path: string;
}

export interface AppConfig {
  grimoire: GrimoireConfig;
  sillytavern: { instances: SillyTavernInstance[] };
  claudeCode: { projects: ClaudeProject[] };
  docker: { refreshSeconds: number };
  todoist: { apiToken: string };
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
}

export interface Mission {
  name: string;
  path: string;
  modified: number;
}

export interface MissionsResult {
  ok: boolean;
  reason?: string;
  missions: Mission[];
}

export interface TodoistTask {
  id: string;
  content: string;
  priority: number;
  due: string | null;
  overdue: boolean;
}

export interface TodoistResult {
  ok: boolean;
  reason?: string;
  tasks: TodoistTask[];
}

export interface LaunchResult {
  ok: boolean;
  reason?: string;
}

export interface CommandCenterApi {
  getConfig: () => Promise<AppConfig>;
  docker: {
    list: () => Promise<DockerResult>;
  };
  grimoire: {
    dailyNote: () => Promise<DailyNoteResult>;
    missions: () => Promise<MissionsResult>;
  };
  todoist: {
    tasks: () => Promise<TodoistResult>;
  };
  openUrl: (url: string) => Promise<boolean>;
  claude: {
    launch: (projectPath: string) => Promise<LaunchResult>;
  };
}
