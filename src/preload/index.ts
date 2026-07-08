// The preload is the ONLY place the sandboxed UI can reach into Electron.
// We expose a small, explicit API — the UI can call these named functions,
// but it can't run arbitrary Node code. Each function just forwards to an
// IPC handler defined in the main process.

import { contextBridge, ipcRenderer } from "electron";
import type { CommandCenterApi } from "../shared/types";

const api: CommandCenterApi = {
  getConfig: () => ipcRenderer.invoke("config:get"),

  docker: {
    list: () => ipcRenderer.invoke("docker:list"),
  },

  grimoire: {
    dailyNote: () => ipcRenderer.invoke("grimoire:dailyNote"),
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
};

contextBridge.exposeInMainWorld("api", api);
