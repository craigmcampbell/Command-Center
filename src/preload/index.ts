// The preload is the ONLY place the sandboxed UI can reach into Electron.
// We expose a small, explicit API — the UI can call these named functions,
// but it can't run arbitrary Node code. Each function just forwards to an
// IPC handler defined in the main process.

import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  AppAlert,
  AppCommand,
  BackupSettings,
  CaptureSettings,
  CaptureTarget,
  CommandCenterApi,
  GoogleCalendarConfig,
  GrimoireConfig,
  GitHubScalarConfig,
  GitHubRepoInput,
  HabitFrequencyType,
  LinkListKind,
  NotificationSettings,
  OpenRouterPeriod,
  OpenRouterScalarConfig,
  OpenAIPeriod,
  OpenAIScalarConfig,
  ProcessConfig,
  TraySummary,
  YnabScalarConfig,
  YnabNewTransactionInput,
} from "../shared/types";

const api: CommandCenterApi = {
  docker: {
    list: () => ipcRenderer.invoke("docker:list"),
    start: (name: string) => ipcRenderer.invoke("docker:start", name),
    stop: (name: string) => ipcRenderer.invoke("docker:stop", name),
  },

  spotify: {
    nowPlaying: () => ipcRenderer.invoke("spotify:nowPlaying"),
  },

  grimoire: {
    dailyNote: (date?: string) => ipcRenderer.invoke("grimoire:dailyNote", date),
    saveDailyNote: (date: string, content: string) =>
      ipcRenderer.invoke("grimoire:dailyNote:save", date, content),
    missions: () => ipcRenderer.invoke("grimoire:missions"),
    financeReviewLog: () => ipcRenderer.invoke("grimoire:financeReviewLog"),
    saveFinanceReviewLog: (content: string) =>
      ipcRenderer.invoke("grimoire:saveFinanceReviewLog", content),
  },

  todoist: {
    tasks: () => ipcRenderer.invoke("todoist:tasks"),
    complete: (taskId: string) => ipcRenderer.invoke("todoist:complete", taskId),
    create: (content: string, projectId?: string) =>
      ipcRenderer.invoke("todoist:create", content, projectId),
    setDueDate: (taskId: string, date: string | null) =>
      ipcRenderer.invoke("todoist:setDueDate", taskId, date),
    move: (taskId: string, projectId: string) => ipcRenderer.invoke("todoist:move", taskId, projectId),
  },

  timeTracking: {
    activeTimer: () => ipcRenderer.invoke("timeTracking:activeTimer"),
    summaries: (taskIds: string[]) => ipcRenderer.invoke("timeTracking:summaries", taskIds),
    start: (taskId: string, taskContent: string, projectName: string) =>
      ipcRenderer.invoke("timeTracking:start", taskId, taskContent, projectName),
    stop: () => ipcRenderer.invoke("timeTracking:stop"),
    addManual: (
      taskId: string,
      taskContent: string,
      projectName: string,
      minutes: number,
      date?: string
    ) => ipcRenderer.invoke("timeTracking:addManual", taskId, taskContent, projectName, minutes, date),
    entries: (taskId: string) => ipcRenderer.invoke("timeTracking:entries", taskId),
    deleteEntry: (entryId: number, taskId: string) =>
      ipcRenderer.invoke("timeTracking:deleteEntry", entryId, taskId),
    monthlyReport: (month: string) => ipcRenderer.invoke("timeTracking:monthlyReport", month),
  },

  openUrl: (url: string) => ipcRenderer.invoke("open:url", url),

  claude: {
    launch: (projectPath: string) => ipcRenderer.invoke("claude:launch", projectPath),
    usage: () => ipcRenderer.invoke("claude:usage"),
    sessions: (limit?: number) => ipcRenderer.invoke("claude:sessions", limit),
    resume: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke("claude:resume", sessionId, cwd),
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
    list: (includeArchived?: boolean) => ipcRenderer.invoke("habits:list", includeArchived),
    add: (
      name: string,
      frequencyType: HabitFrequencyType,
      targetCount?: number,
      category?: string | null
    ) => ipcRenderer.invoke("habits:add", name, frequencyType, targetCount, category),
    update: (
      id: number,
      name: string,
      frequencyType: HabitFrequencyType,
      targetCount?: number,
      category?: string | null
    ) => ipcRenderer.invoke("habits:update", id, name, frequencyType, targetCount, category),
    remove: (id: number) => ipcRenderer.invoke("habits:remove", id),
    archive: (id: number) => ipcRenderer.invoke("habits:archive", id),
    restore: (id: number) => ipcRenderer.invoke("habits:restore", id),
    reorder: (orderedIds: number[]) => ipcRenderer.invoke("habits:reorder", orderedIds),
    getWeek: (weekStart?: string) => ipcRenderer.invoke("habits:getWeek", weekStart),
    toggle: (habitId: number, date: string) =>
      ipcRenderer.invoke("habits:toggle", habitId, date),
    setCompletionNote: (habitId: number, date: string, note: string | null) =>
      ipcRenderer.invoke("habits:setCompletionNote", habitId, date, note),
    trends: (habitId?: number, weeks?: number) =>
      ipcRenderer.invoke("habits:trends", habitId, weeks),
    streaks: (habitId?: number) => ipcRenderer.invoke("habits:streaks", habitId),
    categories: () => ipcRenderer.invoke("habits:categories"),
    heatmap: (habitId: number, fromDate?: string, toDate?: string) =>
      ipcRenderer.invoke("habits:heatmap", habitId, fromDate, toDate),
  },

  github: {
    status: () => ipcRenderer.invoke("github:status"),
  },

  git: {
    status: () => ipcRenderer.invoke("git:status"),
  },

  openrouter: {
    usage: (period: OpenRouterPeriod) => ipcRenderer.invoke("openrouter:usage", period),
  },

  openai: {
    usage: (period: OpenAIPeriod) => ipcRenderer.invoke("openai:usage", period),
  },

  codex: {
    usage: () => ipcRenderer.invoke("codex:usage"),
    sessions: (limit?: number) => ipcRenderer.invoke("codex:sessions", limit),
    resume: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke("codex:resume", sessionId, cwd),
  },

  notifications: {
    show: (alert: AppAlert) => ipcRenderer.invoke("notifications:show", alert),
    health: () => ipcRenderer.invoke("notifications:health"),
  },

  tray: {
    update: (summary: TraySummary) => ipcRenderer.invoke("tray:update", summary),
  },

  backup: {
    export: () => ipcRenderer.invoke("backup:export"),
    list: () => ipcRenderer.invoke("backup:list"),
    runNow: () => ipcRenderer.invoke("backup:runNow"),
  },

  capture: {
    submit: (target: CaptureTarget, text: string) =>
      ipcRenderer.invoke("capture:submit", target, text),
    cancel: () => ipcRenderer.invoke("capture:cancel"),
    hotkeyStatus: () => ipcRenderer.invoke("capture:hotkeyStatus"),
  },

  // The only main→renderer channel in the app. Deliberately a narrow
  // subscription rather than exposing ipcRenderer: the raw IpcRendererEvent
  // never crosses the bridge (it carries `sender`, which would hand the
  // sandboxed renderer a way to reach back into main), and the returned
  // unsubscribe keeps it safe to call from a useEffect without leaking a
  // listener per remount.
  onCommand: (cb: (command: AppCommand) => void) => {
    const handler = (_event: IpcRendererEvent, command: AppCommand) => cb(command);
    ipcRenderer.on("app:command", handler);
    return () => {
      ipcRenderer.removeListener("app:command", handler);
    };
  },

  ynab: {
    accounts: () => ipcRenderer.invoke("ynab:accounts"),
    unapprovedTransactions: () => ipcRenderer.invoke("ynab:unapprovedTransactions"),
    scheduledTransactions: () => ipcRenderer.invoke("ynab:scheduledTransactions"),
    categories: () => ipcRenderer.invoke("ynab:categories"),
    payees: () => ipcRenderer.invoke("ynab:payees"),
    currentMonth: () => ipcRenderer.invoke("ynab:currentMonth"),
    approveTransaction: (transactionId: string) =>
      ipcRenderer.invoke("ynab:approveTransaction", transactionId),
    clearTransaction: (transactionId: string) =>
      ipcRenderer.invoke("ynab:clearTransaction", transactionId),
    setTransactionCategory: (transactionId: string, categoryId: string) =>
      ipcRenderer.invoke("ynab:setTransactionCategory", transactionId, categoryId),
    setTransactionMemo: (transactionId: string, memo: string) =>
      ipcRenderer.invoke("ynab:setTransactionMemo", transactionId, memo),
    createTransaction: (input: YnabNewTransactionInput) =>
      ipcRenderer.invoke("ynab:createTransaction", input),
    toggleAccountHidden: (accountId: string) =>
      ipcRenderer.invoke("ynab:toggleAccountHidden", accountId),
  },

  bills: {
    list: () => ipcRenderer.invoke("bills:list"),
    add: (label: string, dueDay: number, autopay: boolean) =>
      ipcRenderer.invoke("bills:add", label, dueDay, autopay),
    update: (id: number, label: string, dueDay: number, autopay: boolean) =>
      ipcRenderer.invoke("bills:update", id, label, dueDay, autopay),
    remove: (id: number) => ipcRenderer.invoke("bills:remove", id),
    setNote: (id: number, note: string) => ipcRenderer.invoke("bills:setNote", id, note),
  },

  cards: {
    list: () => ipcRenderer.invoke("cards:list"),
    add: (name: string, creditLimit: number, apr: number, ynabAccountId: string | null) =>
      ipcRenderer.invoke("cards:add", name, creditLimit, apr, ynabAccountId),
    update: (
      id: number,
      name: string,
      creditLimit: number,
      apr: number,
      ynabAccountId: string | null
    ) => ipcRenderer.invoke("cards:update", id, name, creditLimit, apr, ynabAccountId),
    remove: (id: number) => ipcRenderer.invoke("cards:remove", id),
  },

  notes: {
    vaults: () => ipcRenderer.invoke("notes:vaults"),
    browse: (vaultLabel: string, subPath?: string) =>
      ipcRenderer.invoke("notes:browse", vaultLabel, subPath),
    index: (vaultLabel: string) => ipcRenderer.invoke("notes:index", vaultLabel),
    read: (vaultLabel: string, filePath: string) =>
      ipcRenderer.invoke("notes:read", vaultLabel, filePath),
    save: (vaultLabel: string, filePath: string, content: string, expectedMtimeMs?: number) =>
      ipcRenderer.invoke("notes:save", vaultLabel, filePath, content, expectedMtimeMs),
    statMany: (targets: { vaultLabel: string; filePath: string }[]) =>
      ipcRenderer.invoke("notes:statMany", targets),
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
    spotify: {
      update: (values: { enabled: boolean }) =>
        ipcRenderer.invoke("settings:spotify:update", values),
    },
    app: {
      update: (values: { refreshMinutes?: number }) =>
        ipcRenderer.invoke("settings:app:update", values),
    },
    todoist: {
      update: (values: { apiToken: string; showTimeTracking?: boolean }) =>
        ipcRenderer.invoke("settings:todoist:update", values),
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
    git: {
      update: (values: { refreshSeconds?: number }) =>
        ipcRenderer.invoke("settings:git:update", values),
    },
    notifications: {
      update: (values: NotificationSettings) =>
        ipcRenderer.invoke("settings:notifications:update", values),
    },
    backup: {
      update: (values: BackupSettings) => ipcRenderer.invoke("settings:backup:update", values),
    },
    capture: {
      update: (values: CaptureSettings) => ipcRenderer.invoke("settings:capture:update", values),
    },
    ynab: {
      update: (values: YnabScalarConfig) => ipcRenderer.invoke("settings:ynab:update", values),
    },
    openrouter: {
      update: (values: OpenRouterScalarConfig) =>
        ipcRenderer.invoke("settings:openrouter:update", values),
    },
    openai: {
      update: (values: OpenAIScalarConfig) => ipcRenderer.invoke("settings:openai:update", values),
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
      add: (repo: GitHubRepoInput) => ipcRenderer.invoke("settings:githubRepos:add", repo),
      update: (id: number, repo: GitHubRepoInput) =>
        ipcRenderer.invoke("settings:githubRepos:update", id, repo),
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
    tabs: {
      rename: (id: string, label: string) => ipcRenderer.invoke("settings:tabs:rename", id, label),
      reorder: (orderedIds: string[]) => ipcRenderer.invoke("settings:tabs:reorder", orderedIds),
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
