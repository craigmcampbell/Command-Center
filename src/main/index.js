// Main process: this is Node.js land. It has full OS access — it creates the
// window, and it answers requests ("IPC") that the UI sends. The UI itself
// (the renderer) is sandboxed and can't touch the filesystem or run commands;
// it has to ask the main process to do those things. That separation is what
// keeps an Electron app safe.

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const { getDockerContainers } = require("./services/docker");
const { readDailyNote, listMissions } = require("./services/grimoire");
const { openInTerminal } = require("./services/launcher");
const { getDueTasks } = require("./services/todoist");

// Load user config once at startup.
const configPath = path.join(__dirname, "..", "..", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

function createWindow() {
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

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

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

// Todoist: tasks due today or overdue.
ipcMain.handle("todoist:tasks", async () => {
  return getDueTasks(config.todoist);
});

// Open a URL in the user's default browser (for SillyTavern, GitHub, etc.).
ipcMain.handle("open:url", async (_evt, url) => {
  await shell.openExternal(url);
  return true;
});

// Launch a Claude Code session in a terminal, scoped to a project dir.
ipcMain.handle("claude:launch", async (_evt, projectPath) => {
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
