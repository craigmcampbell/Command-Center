// Main process: this is Node.js land. It has full OS access — it creates the
// window, and it answers requests ("IPC") that the UI sends. The UI itself
// (the renderer) is sandboxed and can't touch the filesystem or run commands;
// it has to ask the main process to do those things. That separation is what
// keeps an Electron app safe.

import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import { getDockerContainers, startContainer, stopContainer } from "./services/docker";
import {
  readDailyNote,
  saveDailyNote,
  listMissions,
  readFinanceReviewLog,
  saveFinanceReviewLog,
} from "./services/grimoire";
import { openInTerminal } from "./services/launcher";
import { openInForkLift } from "./services/forklift";
import {
  getDueTasks,
  completeTask,
  createTask,
  setTaskDueDate,
  moveTask,
} from "./services/todoist";
import {
  initTimeTracking,
  getActiveTimer,
  getTaskSummaries,
  startTimer,
  stopActiveTimer,
  addManualEntry,
  listEntries,
  deleteEntry,
  getMonthlyReport,
} from "./services/timeTracking";
import { getEventsForDay, connectGoogleCalendar } from "./services/googleCalendar";
import { initDatabase } from "./services/db";
import {
  initLinks,
  seedFromLegacyConfig,
  listLinks,
  addLink,
  updateLink,
  removeLink,
  reorderLinks,
} from "./services/links";
import type { LegacyLinkConfig } from "./services/links";
import { initScratchpad, getScratchpad, saveScratchpad, clearScratchpad } from "./services/scratchpad";
import {
  initHabits,
  listHabits,
  addHabit,
  updateHabit,
  removeHabit,
  reorderHabits,
  getWeekView,
  toggleCompletion,
  getHabitTrends,
  getAllHabitTrends,
} from "./services/habits";
import {
  listReaderDocuments,
  resetReaderCache,
  archiveDocument,
  deleteDocument,
} from "./services/reader";
import { getGitHubStatus } from "./services/github";
import { getGitStatuses } from "./services/git";
import { getNotificationHealth, showAlert } from "./services/notifications";
import { destroyTray, initTray, updateTray } from "./services/tray";
import { backupsDir, defaultExportName, exportDatabase, listBackups, runDailyBackup } from "./services/backup";
import { capture } from "./services/capture";
import { flushWindowState, restoreBounds, trackWindow } from "./services/windowState";
import {
  captureHotkeyStatus,
  destroyCaptureWindow,
  hideCaptureWindow,
  initCaptureWindow,
  registerCaptureHotkey,
} from "./services/captureWindow";
import {
  getAccounts as getYnabAccounts,
  getUnapprovedTransactions as getYnabUnapprovedTransactions,
  getScheduledTransactionsThisMonth as getYnabScheduledTransactions,
  getCategories as getYnabCategories,
  approveTransaction as approveYnabTransaction,
  clearTransaction as clearYnabTransaction,
  setTransactionCategory as setYnabTransactionCategory,
  setTransactionMemo as setYnabTransactionMemo,
  createTransaction as createYnabTransaction,
} from "./services/ynab";
import {
  initBills,
  listBills,
  addBill,
  updateBill,
  removeBill,
  setBillNote,
} from "./services/bills";
import { initCards, listCards, addCard, updateCard, removeCard } from "./services/cards";
import {
  initNotes,
  browseVault,
  buildVaultIndex,
  readNoteFile,
  saveNoteFile,
  statNotes,
  createNoteFile,
  listTemplates,
  listNavNotes,
  addNavNote,
  removeNavNote,
  getSession,
  setSession,
} from "./services/notes";
import {
  startProcess,
  stopProcess,
  getStatus as getProcessStatus,
  getAllStatus as getAllProcessStatus,
  stopAll as stopAllProcesses,
} from "./services/processes";
import {
  initSettings,
  readLegacyConfigFile,
  seedSettingsFromLegacyConfig,
  getAllSettings,
  getGrimoireSettings,
  updateGrimoireSettings,
  getDockerSettings,
  updateDockerSettings,
  getAppSettings,
  updateAppSettings,
  getTodoistSettings,
  updateTodoistSettings,
  getGoogleCalendarSettings,
  updateGoogleCalendarSettings,
  getReaderSettings,
  updateReaderSettings,
  getGithubScalarSettings,
  updateGithubScalarSettings,
  getGitSettings,
  updateGitSettings,
  updateNotificationSettings,
  getBackupSettings,
  updateBackupSettings,
  getCaptureSettings,
  updateCaptureSettings,
  DEFAULT_CAPTURE_ACCELERATOR,
  getYnabSettings,
  updateYnabSettings,
  toggleYnabAccountHidden,
  listVaultSettings,
  addVault,
  updateVault,
  removeVault,
  reorderVaults,
  listGithubRepoSettings,
  addGithubRepo,
  updateGithubRepo,
  removeGithubRepo,
  reorderGithubRepos,
  listProcessSettings,
  addProcess,
  updateProcess,
  removeProcess,
  reorderProcesses,
  renameTab,
  reorderTabs,
} from "./services/settings";
import type {
  GoogleCalendarConfig,
  GrimoireConfig,
  ActionResult,
  AppAlert,
  AppCommand,
  BackupSettings,
  CaptureSettings,
  CaptureTarget,
  ExportResult,
  GitHubScalarConfig,
  GitHubRepoInput,
  HabitFrequencyType,
  NotificationSettings,
  TraySummary,
  LinkListKind,
  ProcessConfig,
  YnabScalarConfig,
  YnabNewTransactionInput,
} from "../shared/types";

initDatabase();
initLinks();
initScratchpad();
initHabits();
initNotes();
initSettings();
initTimeTracking();
initBills();
initCards();

// One-time migration: reads config.json (if present — dev's repo-root copy,
// or an existing packaged install's userData copy) and seeds every settings
// table/row that's still empty. Read-only: this app never writes to
// config.json again, and a brand-new install that has no config.json at all
// just seeds straight from the bundled config.example.json defaults instead.
// Idempotent, so it's safe to call every boot.
const legacyConfig = readLegacyConfigFile();
seedFromLegacyConfig((legacyConfig ?? {}) as LegacyLinkConfig);
seedSettingsFromLegacyConfig(legacyConfig);

function appIconPath(): string {
  return path.join(__dirname, "..", "..", "build", "icon.png");
}

function setDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const icon = nativeImage.createFromPath(appIconPath());
  if (!icon.isEmpty()) app.dock.setIcon(icon);
}

// Held at module scope so the tray and notification clicks can reach the
// window — everything else in this file is request/response IPC and never
// needed a reference.
let mainWindow: BrowserWindow | null = null;

// Set once a real quit is underway, so the close handler below knows to let
// the window actually close instead of hiding it.
let quitting = false;

// Bring the dashboard back from the tray (or rebuild it if it was genuinely
// destroyed, e.g. on a platform where close isn't intercepted).
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  createWindow();
}

// The single main→renderer channel. Everything else in this app is
// renderer→main invoke; this exists because the tray and notification clicks
// originate here and need to drive the UI.
function sendCommand(command: AppCommand): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:command", command);
}

function createWindow(): void {
  const icon = nativeImage.createFromPath(appIconPath());
  const { maximized, fullscreen, ...bounds } = restoreBounds();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#12100e",
    titleBarStyle: "hiddenInset",
    ...(icon.isEmpty() ? {} : { icon }),
    webPreferences: {
      // preload runs in a privileged context but with limited scope; it's the
      // only bridge between the sandboxed UI and this main process.
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // electron-vite's dev server serves the renderer over HTTP; only a built
  // renderer is loaded from disk.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  if (process.argv.includes("--dev")) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow = win;
  // Fullscreen wins if both are somehow set — it's the more specific state,
  // and maximizing into a fullscreen window would just fight itself.
  if (fullscreen) win.setFullScreen(true);
  else if (maximized) win.maximize();
  trackWindow(win);

  // Close hides rather than destroys. Every poller in this app lives in the
  // renderer (App.tsx), so destroying the window would stop all polling —
  // no notifications and a tray frozen at its last value. Hiding keeps the
  // renderer alive so the app can keep watching in the background. A real
  // quit sets `quitting` first and falls through.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  win.on("closed", () => {
    mainWindow = null;
  });
}

// ---- IPC handlers: each one is something the UI can invoke by name. ----

// Docker container status, plus starting/stopping a container.
ipcMain.handle("docker:list", async () => {
  return getDockerContainers();
});
ipcMain.handle("docker:start", async (_evt, name: string) => {
  return startContainer(name);
});
ipcMain.handle("docker:stop", async (_evt, name: string) => {
  return stopContainer(name);
});

// Grimoire: a daily note (raw markdown, defaults to today) and the missions list.
ipcMain.handle("grimoire:dailyNote", async (_evt, date?: string) => {
  return readDailyNote(getGrimoireSettings(), date);
});
ipcMain.handle("grimoire:dailyNote:save", async (_evt, date: string, content: string) => {
  return saveDailyNote(getGrimoireSettings(), date, content);
});
ipcMain.handle("grimoire:missions", async () => {
  return listMissions(getGrimoireSettings());
});
ipcMain.handle("grimoire:financeReviewLog", async () => {
  return readFinanceReviewLog(getGrimoireSettings());
});
ipcMain.handle("grimoire:saveFinanceReviewLog", async (_evt, content: string) => {
  return saveFinanceReviewLog(getGrimoireSettings(), content);
});

// Todoist: tasks due today or overdue, plus completing/creating tasks.
ipcMain.handle("todoist:tasks", async () => {
  return getDueTasks(getTodoistSettings());
});
ipcMain.handle("todoist:complete", async (_evt, taskId: string) => {
  return completeTask(getTodoistSettings(), taskId);
});
ipcMain.handle("todoist:create", async (_evt, content: string, projectId?: string) => {
  return createTask(getTodoistSettings(), content, projectId);
});
ipcMain.handle("todoist:setDueDate", async (_evt, taskId: string, date: string | null) => {
  return setTaskDueDate(getTodoistSettings(), taskId, date);
});
ipcMain.handle("todoist:move", async (_evt, taskId: string, projectId: string) => {
  return moveTask(getTodoistSettings(), taskId, projectId);
});

// Time tracking: cumulative per-task timers (only one running at a time) and
// manual entries against Todoist tasks, plus the monthly billing report.
ipcMain.handle("timeTracking:activeTimer", () => getActiveTimer());
ipcMain.handle("timeTracking:summaries", (_evt, taskIds: string[]) => getTaskSummaries(taskIds));
ipcMain.handle(
  "timeTracking:start",
  (_evt, taskId: string, taskContent: string, projectName: string) =>
    startTimer(taskId, taskContent, projectName)
);
ipcMain.handle("timeTracking:stop", () => stopActiveTimer());
ipcMain.handle(
  "timeTracking:addManual",
  (
    _evt,
    taskId: string,
    taskContent: string,
    projectName: string,
    minutes: number,
    date?: string
  ) => addManualEntry(taskId, taskContent, projectName, minutes, date)
);
ipcMain.handle("timeTracking:entries", (_evt, taskId: string) => listEntries(taskId));
ipcMain.handle("timeTracking:deleteEntry", (_evt, entryId: number, taskId: string) =>
  deleteEntry(entryId, taskId)
);
ipcMain.handle("timeTracking:monthlyReport", (_evt, month: string) => getMonthlyReport(month));

// Open a URL in the user's default browser (for SillyTavern, GitHub, etc.).
ipcMain.handle("open:url", async (_evt, url: string) => {
  await shell.openExternal(url);
  return true;
});

// Launch a Claude Code session in a terminal, scoped to a project dir.
ipcMain.handle("claude:launch", async (_evt, projectPath: string) => {
  return openInTerminal(projectPath, "claude");
});

// Open a local directory in ForkLift (File Links widget).
ipcMain.handle("forklift:open", async (_evt, dirPath: string) => {
  return openInForkLift(dirPath);
});

// Google Calendar: a day's events (defaults to today), plus the one-time
// OAuth connect flow.
ipcMain.handle("calendar:events", async (_evt, date?: string) => {
  return getEventsForDay(getGoogleCalendarSettings(), date);
});
ipcMain.handle("calendar:connect", async () => {
  return connectGoogleCalendar(getGoogleCalendarSettings());
});

// Local Apps / Learning / Claude Code lists (SQLite-backed).
ipcMain.handle("links:list", (_evt, kind: LinkListKind) => listLinks(kind));
ipcMain.handle("links:add", (_evt, kind: LinkListKind, label: string, link: string) =>
  addLink(kind, label, link)
);
ipcMain.handle(
  "links:update",
  (_evt, kind: LinkListKind, id: number, label: string, link: string) =>
    updateLink(kind, id, label, link)
);
ipcMain.handle("links:remove", (_evt, kind: LinkListKind, id: number) => removeLink(kind, id));
ipcMain.handle("links:reorder", (_evt, kind: LinkListKind, orderedIds: number[]) =>
  reorderLinks(kind, orderedIds)
);

// Readwise Reader: latest saved documents, paginated 15 at a time, plus
// archiving/deleting a document.
ipcMain.handle("reader:list", (_evt, page: number, forceRefresh?: boolean) => {
  if (forceRefresh) resetReaderCache();
  return listReaderDocuments(getReaderSettings(), page);
});
ipcMain.handle("reader:archive", (_evt, id: string, page: number) => {
  return archiveDocument(getReaderSettings(), id, page);
});
ipcMain.handle("reader:delete", (_evt, id: string, page: number) => {
  return deleteDocument(getReaderSettings(), id, page);
});

// GitHub: latest CI run + open PR count per configured repo, plus
// review-requested PRs across all of them.
// Same repo list as github:status — a row contributes to whichever widget its
// fields support (owner+repo → GitHub, localPath → here).
ipcMain.handle("git:status", () => getGitStatuses(listGithubRepoSettings()));

// Transition detection happens in the renderer (that's where the polled state
// lives); main's job is only to turn a decided alert into an OS notification.
ipcMain.handle("notifications:show", (_evt, alert: AppAlert) => {
  showAlert(alert, (tab) => {
    showMainWindow();
    if (tab) sendCommand({ type: "openTab", tab });
  });
});
ipcMain.handle("notifications:health", () => getNotificationHealth());

ipcMain.handle("tray:update", (_evt, summary: TraySummary) => updateTray(summary));

ipcMain.handle("backup:export", async (): Promise<ExportResult> => {
  const result = await dialog.showSaveDialog({
    title: "Export database",
    defaultPath: defaultExportName(),
    filters: [{ name: "SQLite database", extensions: ["db"] }],
  });
  // A dismissed dialog is not a failure — the UI must stay silent for it.
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  const written = await exportDatabase(result.filePath);
  return written.ok ? { ok: true, path: result.filePath } : written;
});
ipcMain.handle("backup:list", () => listBackups());
ipcMain.handle("backup:runNow", async (): Promise<ActionResult> => {
  const dest = path.join(backupsDir(), `manual-${Date.now()}.db`);
  fs.mkdirSync(backupsDir(), { recursive: true });
  return exportDatabase(dest);
});

ipcMain.handle("capture:submit", (_evt, target: CaptureTarget, text: string) => {
  const result = capture(target, text);
  // Both targets are also edited by autosaving widgets holding the whole
  // buffer in memory; tell the renderer to drop its stale copy, or its next
  // save will overwrite what we just appended.
  if (result.ok) sendCommand({ type: "captured", target });
  return result;
});
ipcMain.handle("capture:cancel", () => hideCaptureWindow());
ipcMain.handle("capture:hotkeyStatus", () => captureHotkeyStatus());

ipcMain.handle("github:status", () =>
  getGitHubStatus({ ...getGithubScalarSettings(), repos: listGithubRepoSettings() })
);

// YNAB: account balances, unapproved transactions, and this month's
// scheduled transactions for the configured plan.
ipcMain.handle("ynab:accounts", () => getYnabAccounts(getYnabSettings()));
ipcMain.handle("ynab:unapprovedTransactions", () =>
  getYnabUnapprovedTransactions(getYnabSettings())
);
ipcMain.handle("ynab:scheduledTransactions", () =>
  getYnabScheduledTransactions(getYnabSettings())
);
ipcMain.handle("ynab:categories", () => getYnabCategories(getYnabSettings()));
ipcMain.handle("ynab:approveTransaction", (_evt, transactionId: string) =>
  approveYnabTransaction(getYnabSettings(), transactionId)
);
ipcMain.handle("ynab:clearTransaction", (_evt, transactionId: string) =>
  clearYnabTransaction(getYnabSettings(), transactionId)
);
ipcMain.handle(
  "ynab:setTransactionCategory",
  (_evt, transactionId: string, categoryId: string) =>
    setYnabTransactionCategory(getYnabSettings(), transactionId, categoryId)
);
ipcMain.handle("ynab:setTransactionMemo", (_evt, transactionId: string, memo: string) =>
  setYnabTransactionMemo(getYnabSettings(), transactionId, memo)
);
ipcMain.handle("ynab:createTransaction", (_evt, input: YnabNewTransactionInput) =>
  createYnabTransaction(getYnabSettings(), input)
);
ipcMain.handle("ynab:toggleAccountHidden", async (_evt, accountId: string) => {
  toggleYnabAccountHidden(accountId);
  return getYnabAccounts(getYnabSettings());
});

// Bills: manually-tracked recurring bills (day-of-month due + autopay flag),
// separate from YNAB's own scheduled transactions.
ipcMain.handle("bills:list", () => listBills());
ipcMain.handle("bills:add", (_evt, label: string, dueDay: number, autopay: boolean) =>
  addBill(label, dueDay, autopay)
);
ipcMain.handle(
  "bills:update",
  (_evt, id: number, label: string, dueDay: number, autopay: boolean) =>
    updateBill(id, label, dueDay, autopay)
);
ipcMain.handle("bills:remove", (_evt, id: number) => removeBill(id));
ipcMain.handle("bills:setNote", (_evt, id: number, note: string) => setBillNote(id, note));

// Cards: manually-tracked credit cards (name, credit limit, APR), shown
// alongside Bills in the Finances tab.
ipcMain.handle("cards:list", () => listCards());
ipcMain.handle("cards:add", (_evt, name: string, creditLimit: number, apr: number) =>
  addCard(name, creditLimit, apr)
);
ipcMain.handle(
  "cards:update",
  (_evt, id: number, name: string, creditLimit: number, apr: number) =>
    updateCard(id, name, creditLimit, apr)
);
ipcMain.handle("cards:remove", (_evt, id: number) => removeCard(id));

// Notes: browsing/reading/writing files in configured Obsidian vaults, plus
// the left-nav pin list and open-tabs session (both SQLite).
ipcMain.handle("notes:vaults", () => listVaultSettings());
ipcMain.handle("notes:browse", (_evt, vaultLabel: string, subPath?: string) =>
  browseVault(vaultLabel, subPath)
);
ipcMain.handle("notes:index", (_evt, vaultLabel: string) => buildVaultIndex(vaultLabel));
ipcMain.handle("notes:read", (_evt, vaultLabel: string, filePath: string) =>
  readNoteFile(vaultLabel, filePath)
);
ipcMain.handle(
  "notes:save",
  (_evt, vaultLabel: string, filePath: string, content: string, expectedMtimeMs?: number) =>
    saveNoteFile(vaultLabel, filePath, content, expectedMtimeMs)
);
ipcMain.handle("notes:statMany", (_evt, targets: { vaultLabel: string; filePath: string }[]) =>
  statNotes(targets)
);
ipcMain.handle(
  "notes:create",
  (_evt, vaultLabel: string, dirPath: string, name: string, templatePath?: string | null) =>
    createNoteFile(vaultLabel, dirPath, name, templatePath)
);
ipcMain.handle("notes:templates", (_evt, vaultLabel: string) => listTemplates(vaultLabel));
ipcMain.handle("notes:nav:list", () => listNavNotes());
ipcMain.handle("notes:nav:add", (_evt, vaultLabel: string, filePath: string, label: string) =>
  addNavNote(vaultLabel, filePath, label)
);
ipcMain.handle("notes:nav:remove", (_evt, id: number) => removeNavNote(id));
ipcMain.handle("notes:session:get", () => getSession());
ipcMain.handle("notes:session:set", (_evt, openNoteIds: number[], activeNoteId: number | null) =>
  setSession(openNoteIds, activeNoteId)
);

// Scratchpad: single autosaved markdown note.
ipcMain.handle("scratchpad:get", () => getScratchpad());
ipcMain.handle("scratchpad:save", (_evt, content: string) => {
  saveScratchpad(content);
});
ipcMain.handle("scratchpad:clear", () => {
  clearScratchpad();
});

// Habit tracker: SQLite-backed habits + per-day completions.
ipcMain.handle("habits:list", () => listHabits());
ipcMain.handle(
  "habits:add",
  (_evt, name: string, frequencyType: HabitFrequencyType, targetCount?: number) =>
    addHabit(name, frequencyType, targetCount)
);
ipcMain.handle(
  "habits:update",
  (
    _evt,
    id: number,
    name: string,
    frequencyType: HabitFrequencyType,
    targetCount?: number
  ) => updateHabit(id, name, frequencyType, targetCount)
);
ipcMain.handle("habits:remove", (_evt, id: number) => removeHabit(id));
ipcMain.handle("habits:reorder", (_evt, orderedIds: number[]) => reorderHabits(orderedIds));
ipcMain.handle("habits:getWeek", (_evt, weekStart?: string) => getWeekView(weekStart));
ipcMain.handle("habits:toggle", (_evt, habitId: number, date: string) =>
  toggleCompletion(habitId, date)
);
ipcMain.handle("habits:trends", (_evt, habitId?: number, weeks?: number) => {
  if (habitId != null) return getHabitTrends(habitId, weeks ?? 12);
  return getAllHabitTrends(weeks ?? 12);
});

// Managed local processes (Development tab): start/stop/tail arbitrary
// long-running tools configured in Settings. Not a terminal — no
// PTY/interactive input, just spawn + log tail + a reliable group kill.
ipcMain.handle("process:start", (_evt, id: string) => {
  const procConfig = listProcessSettings().find((p) => p.id === id);
  if (!procConfig) return { ok: false, reason: "Unknown process" };

  const result = startProcess(procConfig);
  if (result.ok && procConfig.autoOpenUrl && procConfig.url) {
    setTimeout(() => {
      shell.openExternal(procConfig.url!);
    }, procConfig.openDelayMs ?? 0);
  }
  return result;
});
ipcMain.handle("process:stop", (_evt, id: string) => stopProcess(id));
ipcMain.handle("process:status", (_evt, id: string) => getProcessStatus(id));
ipcMain.handle("process:statusAll", () => getAllProcessStatus());

// Settings: everything that used to live in config.json, now SQLite-backed
// and editable live from the Settings overlay (gear icon). Scalar sections
// each get a get-implicitly-via-getAll + explicit update; the three array
// sections (vaults, github repos, processes) get full CRUD + reorder,
// mirroring the links:* handlers above.
ipcMain.handle("settings:getAll", () => getAllSettings());
ipcMain.handle("settings:grimoire:update", (_evt, values: GrimoireConfig) =>
  updateGrimoireSettings(values)
);
ipcMain.handle("settings:git:update", (_evt, values: { refreshSeconds?: number }) =>
  updateGitSettings(values)
);
ipcMain.handle("settings:notifications:update", (_evt, values: NotificationSettings) =>
  updateNotificationSettings(values)
);
ipcMain.handle("settings:backup:update", (_evt, values: BackupSettings) =>
  updateBackupSettings(values)
);
// Re-register immediately so a changed accelerator takes effect without a
// restart — and so the Settings UI can report right away whether the new one
// was actually claimable.
ipcMain.handle("settings:capture:update", (_evt, values: CaptureSettings) => {
  const saved = updateCaptureSettings(values);
  if (saved.accelerator) registerCaptureHotkey(saved.accelerator);
  return saved;
});
ipcMain.handle("settings:docker:update", (_evt, values: { refreshSeconds: number }) =>
  updateDockerSettings(values)
);
ipcMain.handle("settings:app:update", (_evt, values: { refreshMinutes?: number }) =>
  updateAppSettings(values)
);
ipcMain.handle(
  "settings:todoist:update",
  (_evt, values: { apiToken: string; showTimeTracking?: boolean }) =>
    updateTodoistSettings(values)
);
ipcMain.handle("settings:googleCalendar:update", (_evt, values: GoogleCalendarConfig) =>
  updateGoogleCalendarSettings(values)
);
ipcMain.handle("settings:reader:update", (_evt, values: { apiToken: string }) =>
  updateReaderSettings(values)
);
ipcMain.handle("settings:github:update", (_evt, values: GitHubScalarConfig) =>
  updateGithubScalarSettings(values)
);
ipcMain.handle("settings:ynab:update", (_evt, values: YnabScalarConfig) =>
  updateYnabSettings(values)
);

ipcMain.handle("settings:vaults:list", () => listVaultSettings());
ipcMain.handle("settings:vaults:add", (_evt, label: string, vaultPath: string) =>
  addVault(label, vaultPath)
);
ipcMain.handle("settings:vaults:update", (_evt, id: number, label: string, vaultPath: string) =>
  updateVault(id, label, vaultPath)
);
ipcMain.handle("settings:vaults:remove", (_evt, id: number) => removeVault(id));
ipcMain.handle("settings:vaults:reorder", (_evt, orderedIds: number[]) => reorderVaults(orderedIds));

ipcMain.handle("settings:githubRepos:list", () => listGithubRepoSettings());
ipcMain.handle("settings:githubRepos:add", (_evt, input: GitHubRepoInput) =>
  addGithubRepo(input)
);
ipcMain.handle("settings:githubRepos:update", (_evt, id: number, input: GitHubRepoInput) =>
  updateGithubRepo(id, input)
);
ipcMain.handle("settings:githubRepos:remove", (_evt, id: number) => removeGithubRepo(id));
ipcMain.handle("settings:githubRepos:reorder", (_evt, orderedIds: number[]) =>
  reorderGithubRepos(orderedIds)
);

ipcMain.handle("settings:processes:list", () => listProcessSettings());
ipcMain.handle("settings:processes:add", (_evt, proc: Omit<ProcessConfig, "sortOrder">) =>
  addProcess(proc)
);
ipcMain.handle(
  "settings:processes:update",
  (_evt, id: string, proc: Omit<ProcessConfig, "id" | "sortOrder">) => updateProcess(id, proc)
);
ipcMain.handle("settings:processes:remove", (_evt, id: string) => removeProcess(id));
ipcMain.handle("settings:processes:reorder", (_evt, orderedIds: string[]) =>
  reorderProcesses(orderedIds)
);

ipcMain.handle("settings:tabs:rename", (_evt, id: string, label: string) => renameTab(id, label));
ipcMain.handle("settings:tabs:reorder", (_evt, orderedIds: string[]) => reorderTabs(orderedIds));

app.whenReady().then(() => {
  setDockIcon();
  createWindow();

  // Fire-and-forget: a backup must never delay startup or break it.
  const backupSettings = getBackupSettings();
  void runDailyBackup(backupSettings.enabled !== false, backupSettings.keep ?? 7);

  initCaptureWindow();
  registerCaptureHotkey(getCaptureSettings().accelerator ?? DEFAULT_CAPTURE_ACCELERATOR);

  initTray({
    onShow: showMainWindow,
    onRefresh: () => sendCommand({ type: "refreshAll" }),
    onQuit: () => app.quit(),
  });
  // Clicking the Dock icon reopens the hidden window, same as the tray's Show.
  app.on("activate", showMainWindow);
});

app.on("window-all-closed", () => {
  // On macOS the window is hidden rather than destroyed (see createWindow), so
  // this generally won't fire at all — the app lives on in the tray until an
  // explicit Quit.
  if (process.platform !== "darwin") app.quit();
});

// Kill every managed process before the app actually exits, so closing the
// dashboard never leaves an orphaned dev server/tool running. The group
// kills are async, so we hold up quitting until they resolve rather than
// firing-and-forgetting. Once cleanup is done we use app.exit() rather than
// calling app.quit() again — app.exit() terminates immediately without
// re-emitting before-quit/will-quit, which sidesteps a real-world case
// where a second app.quit() from inside this handler never actually
// completed the exit (observed in dev mode with the detached DevTools
// window still open).
// `quitting` is declared up by createWindow — the window's close handler needs
// it too, to tell a real quit apart from a hide-to-tray.
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  destroyTray();
  // Close hides rather than destroys, so there's no close event to save on;
  // this is the last chance, and it also flushes any pending debounce.
  flushWindowState();
  // Also unregisters the global shortcut — leaving it claimed after quit
  // would make the hotkey dead until the next launch.
  destroyCaptureWindow();
  stopAllProcesses().finally(() => app.exit());
});
