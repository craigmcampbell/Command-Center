// Main process: this is Node.js land. It has full OS access — it creates the
// window, and it answers requests ("IPC") that the UI sends. The UI itself
// (the renderer) is sandboxed and can't touch the filesystem or run commands;
// it has to ask the main process to do those things. That separation is what
// keeps an Electron app safe.

import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron";
import path from "node:path";
import fs from "node:fs";

import { getDockerContainers, startContainer, stopContainer } from "./services/docker";
import { readDailyNote, saveDailyNote, listMissions } from "./services/grimoire";
import { openInTerminal } from "./services/launcher";
import { getDueTasks, completeTask, createTask } from "./services/todoist";
import { getEventsForDay, connectGoogleCalendar } from "./services/googleCalendar";
import {
  initDatabase,
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
import {
  initNotes,
  listVaults,
  browseVault,
  buildVaultIndex,
  readNoteFile,
  saveNoteFile,
  createNoteFile,
  listNavNotes,
  addNavNote,
  removeNavNote,
  getSession,
  setSession,
} from "./services/notes";
import type { AppConfig, HabitFrequencyType, LinkListKind } from "../shared/types";

// Load user config once at startup. In dev this reads straight from the repo
// so editing config.json just works. A packaged app's bundle is immutable
// (and asar'd), so config.json instead lives in the standard per-app data
// directory, seeded on first launch from the bundled config.example.json.
// Returns the raw parsed JSON — callers cast it to AppConfig (the current
// schema) or LegacyLinkConfig (for the one-time links-table migration,
// since older config.json files still have localApps/learning/claudeCode
// keys that AppConfig no longer declares).
function loadConfig(): Record<string, unknown> {
  if (!app.isPackaged) {
    const devConfigPath = path.join(__dirname, "..", "..", "config.json");
    return JSON.parse(fs.readFileSync(devConfigPath, "utf8"));
  }

  const userConfigPath = path.join(app.getPath("userData"), "config.json");
  const defaults = JSON.parse(
    fs.readFileSync(path.join(process.resourcesPath, "config.example.json"), "utf8")
  );

  if (!fs.existsSync(userConfigPath)) {
    fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
    fs.writeFileSync(userConfigPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  // A user's config.json is seeded once and then never touched by updates, so
  // a top-level section added to config.example.json after that (e.g.
  // googleCalendar) would otherwise stay permanently missing — leaving
  // `config.<newSection>` undefined and crashing any service that reads it.
  // Backfill any missing top-level keys from the bundled defaults so old
  // installs pick up new config sections automatically.
  const userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf8"));
  let changed = false;
  for (const key of Object.keys(defaults)) {
    if (!(key in userConfig)) {
      userConfig[key] = defaults[key];
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
  }
  return userConfig;
}

const rawConfig = loadConfig();
const config = rawConfig as unknown as AppConfig;

initDatabase();
initScratchpad();
initHabits();
initNotes();
seedFromLegacyConfig(rawConfig as LegacyLinkConfig);

function appIconPath(): string {
  return path.join(__dirname, "..", "..", "build", "icon.png");
}

function setDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const icon = nativeImage.createFromPath(appIconPath());
  if (!icon.isEmpty()) app.dock.setIcon(icon);
}

function createWindow(): void {
  const icon = nativeImage.createFromPath(appIconPath());
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
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
}

// ---- IPC handlers: each one is something the UI can invoke by name. ----

// Give the UI its config (so widgets know paths, ports, instances).
ipcMain.handle("config:get", () => config);

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
  return readDailyNote(config.grimoire, date);
});
ipcMain.handle("grimoire:dailyNote:save", async (_evt, date: string, content: string) => {
  return saveDailyNote(config.grimoire, date, content);
});
ipcMain.handle("grimoire:missions", async () => {
  return listMissions(config.grimoire);
});

// Todoist: tasks due today or overdue, plus completing/creating tasks.
ipcMain.handle("todoist:tasks", async () => {
  return getDueTasks(config.todoist);
});
ipcMain.handle("todoist:complete", async (_evt, taskId: string) => {
  return completeTask(config.todoist, taskId);
});
ipcMain.handle("todoist:create", async (_evt, content: string) => {
  return createTask(config.todoist, content);
});

// Open a URL in the user's default browser (for SillyTavern, GitHub, etc.).
ipcMain.handle("open:url", async (_evt, url: string) => {
  await shell.openExternal(url);
  return true;
});

// Launch a Claude Code session in a terminal, scoped to a project dir.
ipcMain.handle("claude:launch", async (_evt, projectPath: string) => {
  return openInTerminal(projectPath, "claude");
});

// Google Calendar: a day's events (defaults to today), plus the one-time
// OAuth connect flow.
ipcMain.handle("calendar:events", async (_evt, date?: string) => {
  return getEventsForDay(config.googleCalendar, date);
});
ipcMain.handle("calendar:connect", async () => {
  return connectGoogleCalendar(config.googleCalendar);
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
  return listReaderDocuments(config.reader, page);
});
ipcMain.handle("reader:archive", (_evt, id: string, page: number) => {
  return archiveDocument(config.reader, id, page);
});
ipcMain.handle("reader:delete", (_evt, id: string, page: number) => {
  return deleteDocument(config.reader, id, page);
});

// GitHub: latest CI run + open PR count per configured repo, plus
// review-requested PRs across all of them.
ipcMain.handle("github:status", () => getGitHubStatus(config.github));

// Notes: browsing/reading/writing files in configured Obsidian vaults, plus
// the left-nav pin list and open-tabs session (both SQLite).
ipcMain.handle("notes:vaults", () => listVaults(config));
ipcMain.handle("notes:browse", (_evt, vaultLabel: string, subPath?: string) =>
  browseVault(config, vaultLabel, subPath)
);
ipcMain.handle("notes:index", (_evt, vaultLabel: string) => buildVaultIndex(config, vaultLabel));
ipcMain.handle("notes:read", (_evt, vaultLabel: string, filePath: string) =>
  readNoteFile(config, vaultLabel, filePath)
);
ipcMain.handle("notes:save", (_evt, vaultLabel: string, filePath: string, content: string) =>
  saveNoteFile(config, vaultLabel, filePath, content)
);
ipcMain.handle("notes:create", (_evt, vaultLabel: string, dirPath: string, name: string) =>
  createNoteFile(config, vaultLabel, dirPath, name)
);
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

app.whenReady().then(() => {
  setDockIcon();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
