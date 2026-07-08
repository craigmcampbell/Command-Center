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
import type { AppConfig } from "../shared/types";

// Load user config once at startup.
const configPath = path.join(__dirname, "..", "..", "config.json");
const config: AppConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

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

// Grimoire: today's daily note (raw markdown) and the missions list.
ipcMain.handle("grimoire:dailyNote", async () => {
  return readDailyNote(config.grimoire);
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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
