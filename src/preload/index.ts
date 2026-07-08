// The preload is the ONLY place the sandboxed UI can reach into Electron.
// We expose a small, explicit API — the UI can call these named functions,
// but it can't run arbitrary Node code. Each function just forwards to an
// IPC handler defined in the main process.

import { contextBridge, ipcRenderer } from "electron";
import type { CommandCenterApi, LinkListKind } from "../shared/types";

const api: CommandCenterApi = {
  getConfig: () => ipcRenderer.invoke("config:get"),

  docker: {
    list: () => ipcRenderer.invoke("docker:list"),
    start: (name: string) => ipcRenderer.invoke("docker:start", name),
    stop: (name: string) => ipcRenderer.invoke("docker:stop", name),
  },

  grimoire: {
    dailyNote: (date?: string) => ipcRenderer.invoke("grimoire:dailyNote", date),
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
};

contextBridge.exposeInMainWorld("api", api);
