// Main process: this is Node.js land. It has full OS access — it creates the
// window, and it answers requests ("IPC") that the UI sends. The UI itself
// (the renderer) is sandboxed and can't touch the filesystem or run commands;
// it has to ask the main process to do those things. That separation is what
// keeps an Electron app safe.

import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";

import { getDockerContainers } from "./services/docker";
import { readDailyNote, listMissions } from "./services/grimoire";
import { openInTerminal } from "./services/launcher";
import { getDueTasks, completeTask, createTask } from "./services/todoist";
import { getEventsForDay, connectGoogleCalendar } from "./services/googleCalendar";
import type { AppConfig } from "../shared/types";

// Load user config once at startup. In dev this reads straight from the repo
// so editing config.json just works. A packaged app's bundle is immutable
// (and asar'd), so config.json instead lives in the standard per-app data
// directory, seeded on first launch from the bundled config.example.json.
function loadConfig(): AppConfig {
  if (!app.isPackaged) {
    const devConfigPath = path.join(__dirname, "..", "..", "config.json");
    return JSON.parse(fs.readFileSync(devConfigPath, "utf8"));
  }

  const userConfigPath = path.join(app.getPath("userData"), "config.json");
  if (!fs.existsSync(userConfigPath)) {
    fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
    fs.copyFileSync(path.join(process.resourcesPath, "config.example.json"), userConfigPath);
  }
  return JSON.parse(fs.readFileSync(userConfigPath, "utf8"));
}

const config: AppConfig = loadConfig();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#12100e",
    titleBarStyle: "hiddenInset",
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

// Docker container status.
ipcMain.handle("docker:list", async () => {
  return getDockerContainers();
});

// Grimoire: a daily note (raw markdown, defaults to today) and the missions list.
ipcMain.handle("grimoire:dailyNote", async (_evt, date?: string) => {
  return readDailyNote(config.grimoire, date);
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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
