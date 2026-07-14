// The preload is the ONLY place the sandboxed UI can reach into Electron.
// We expose a small, explicit API — the UI can call these named functions,
// but it can't run arbitrary Node code. Each function just forwards to an
// IPC handler defined in the main process.

import { contextBridge, ipcRenderer } from "electron";
import type {
  CommandCenterApi,
  GoogleCalendarConfig,
  GrimoireConfig,
  GitHubScalarConfig,
  HabitFrequencyType,
  LinkListKind,
  ProcessConfig,
} from "../shared/types";

const api: CommandCenterApi = {
  docker: {
    list: () => ipcRenderer.invoke("docker:list"),
    start: (name: string) => ipcRenderer.invoke("docker:start", name),
    stop: (name: string) => ipcRenderer.invoke("docker:stop", name),
  },

  grimoire: {
    dailyNote: (date?: string) => ipcRenderer.invoke("grimoire:dailyNote", date),
    saveDailyNote: (date: string, content: string) =>
      ipcRenderer.invoke("grimoire:dailyNote:save", date, content),
    missions: () => ipcRenderer.invoke("grimoire:missions"),
  },

  todoist: {
    tasks: () => ipcRenderer.invoke("todoist:tasks"),
    complete: (taskId: string) => ipcRenderer.invoke("todoist:complete", taskId),
    create: (content: string) => ipcRenderer.invoke("todoist:create", content),
  },

  openUrl: (url: string) => ipcRenderer.invoke("open:url", url),

  claude: {
    launch: (projectPath: string) => ipcRenderer.invoke("claude:launch", projectPath),
  },

  forklift: {
    open: (dirPath: string) => ipcRenderer.invoke("forklift:open", dirPath),
  },

  calendar: {
    events: (date?: string) => ipcRenderer.invoke("calendar:events", date),
    connect: () => ipcRenderer.invoke("calendar:connect"),
  },

  links: {
    list: (kind: LinkListKind) => ipcRenderer.invoke("links:list", kind),
    add: (kind: LinkListKind, label: string, link: string) =>
      ipcRenderer.invoke("links:add", kind, label, link),
    update: (kind: LinkListKind, id: number, label: string, link: string) =>
      ipcRenderer.invoke("links:update", kind, id, label, link),
    remove: (kind: LinkListKind, id: number) => ipcRenderer.invoke("links:remove", kind, id),
    reorder: (kind: LinkListKind, orderedIds: number[]) =>
      ipcRenderer.invoke("links:reorder", kind, orderedIds),
  },

  reader: {
    list: (page: number, forceRefresh?: boolean) =>
      ipcRenderer.invoke("reader:list", page, forceRefresh),
    archive: (id: string, page: number) => ipcRenderer.invoke("reader:archive", id, page),
    delete: (id: string, page: number) => ipcRenderer.invoke("reader:delete", id, page),
  },

  scratchpad: {
    get: () => ipcRenderer.invoke("scratchpad:get"),
    save: (content: string) => ipcRenderer.invoke("scratchpad:save", content),
    clear: () => ipcRenderer.invoke("scratchpad:clear"),
  },

  habits: {
    list: () => ipcRenderer.invoke("habits:list"),
    add: (name: string, frequencyType: HabitFrequencyType, targetCount?: number) =>
      ipcRenderer.invoke("habits:add", name, frequencyType, targetCount),
    update: (
      id: number,
      name: string,
      frequencyType: HabitFrequencyType,
      targetCount?: number
    ) => ipcRenderer.invoke("habits:update", id, name, frequencyType, targetCount),
    remove: (id: number) => ipcRenderer.invoke("habits:remove", id),
    reorder: (orderedIds: number[]) => ipcRenderer.invoke("habits:reorder", orderedIds),
    getWeek: (weekStart?: string) => ipcRenderer.invoke("habits:getWeek", weekStart),
    toggle: (habitId: number, date: string) =>
      ipcRenderer.invoke("habits:toggle", habitId, date),
    trends: (habitId?: number, weeks?: number) =>
      ipcRenderer.invoke("habits:trends", habitId, weeks),
  },

  github: {
    status: () => ipcRenderer.invoke("github:status"),
  },

  notes: {
    vaults: () => ipcRenderer.invoke("notes:vaults"),
    browse: (vaultLabel: string, subPath?: string) =>
      ipcRenderer.invoke("notes:browse", vaultLabel, subPath),
    index: (vaultLabel: string) => ipcRenderer.invoke("notes:index", vaultLabel),
    read: (vaultLabel: string, filePath: string) =>
      ipcRenderer.invoke("notes:read", vaultLabel, filePath),
    save: (vaultLabel: string, filePath: string, content: string) =>
      ipcRenderer.invoke("notes:save", vaultLabel, filePath, content),
    create: (vaultLabel: string, dirPath: string, name: string, templatePath?: string | null) =>
      ipcRenderer.invoke("notes:create", vaultLabel, dirPath, name, templatePath),
    templates: (vaultLabel: string) => ipcRenderer.invoke("notes:templates", vaultLabel),
    nav: {
      list: () => ipcRenderer.invoke("notes:nav:list"),
      add: (vaultLabel: string, filePath: string, label: string) =>
        ipcRenderer.invoke("notes:nav:add", vaultLabel, filePath, label),
      remove: (id: number) => ipcRenderer.invoke("notes:nav:remove", id),
    },
    session: {
      get: () => ipcRenderer.invoke("notes:session:get"),
      set: (openNoteIds: number[], activeNoteId: number | null) =>
        ipcRenderer.invoke("notes:session:set", openNoteIds, activeNoteId),
    },
  },

  process: {
    start: (id: string) => ipcRenderer.invoke("process:start", id),
    stop: (id: string) => ipcRenderer.invoke("process:stop", id),
    status: (id: string) => ipcRenderer.invoke("process:status", id),
    statusAll: () => ipcRenderer.invoke("process:statusAll"),
  },

  settings: {
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    grimoire: {
      update: (values: GrimoireConfig) => ipcRenderer.invoke("settings:grimoire:update", values),
    },
    docker: {
      update: (values: { refreshSeconds: number }) =>
        ipcRenderer.invoke("settings:docker:update", values),
    },
    app: {
      update: (values: { refreshMinutes?: number }) =>
        ipcRenderer.invoke("settings:app:update", values),
    },
    todoist: {
      update: (values: { apiToken: string }) => ipcRenderer.invoke("settings:todoist:update", values),
    },
    googleCalendar: {
      update: (values: GoogleCalendarConfig) =>
        ipcRenderer.invoke("settings:googleCalendar:update", values),
    },
    reader: {
      update: (values: { apiToken: string }) => ipcRenderer.invoke("settings:reader:update", values),
    },
    github: {
      update: (values: GitHubScalarConfig) => ipcRenderer.invoke("settings:github:update", values),
    },
    vaults: {
      list: () => ipcRenderer.invoke("settings:vaults:list"),
      add: (label: string, path: string) => ipcRenderer.invoke("settings:vaults:add", label, path),
      update: (id: number, label: string, path: string) =>
        ipcRenderer.invoke("settings:vaults:update", id, label, path),
      remove: (id: number) => ipcRenderer.invoke("settings:vaults:remove", id),
      reorder: (orderedIds: number[]) => ipcRenderer.invoke("settings:vaults:reorder", orderedIds),
    },
    githubRepos: {
      list: () => ipcRenderer.invoke("settings:githubRepos:list"),
      add: (label: string, owner: string, repo: string, branch: string) =>
        ipcRenderer.invoke("settings:githubRepos:add", label, owner, repo, branch),
      update: (id: number, label: string, owner: string, repo: string, branch: string) =>
        ipcRenderer.invoke("settings:githubRepos:update", id, label, owner, repo, branch),
      remove: (id: number) => ipcRenderer.invoke("settings:githubRepos:remove", id),
      reorder: (orderedIds: number[]) =>
        ipcRenderer.invoke("settings:githubRepos:reorder", orderedIds),
    },
    processes: {
      list: () => ipcRenderer.invoke("settings:processes:list"),
      add: (proc: Omit<ProcessConfig, "sortOrder">) =>
        ipcRenderer.invoke("settings:processes:add", proc),
      update: (id: string, proc: Omit<ProcessConfig, "id" | "sortOrder">) =>
        ipcRenderer.invoke("settings:processes:update", id, proc),
      remove: (id: string) => ipcRenderer.invoke("settings:processes:remove", id),
      reorder: (orderedIds: string[]) =>
        ipcRenderer.invoke("settings:processes:reorder", orderedIds),
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
