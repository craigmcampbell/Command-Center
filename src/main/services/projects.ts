import path from "node:path";
import os from "node:os";
import type { Project, ProjectInput } from "../../shared/types";
import { getDatabase } from "./db";
import { addGithubRepo, listGithubRepoSettings } from "./settings";

export function initProjects(): void {
  getDatabase().exec(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, sort_order INTEGER NOT NULL
  )`);
}
export function listProjects(): Project[] {
  return (getDatabase().prepare("SELECT id, data, sort_order FROM projects ORDER BY sort_order, id").all() as
    { id: number; data: string; sort_order: number }[]).map(row => ({ ...JSON.parse(row.data), id: row.id, sortOrder: row.sort_order }));
}
export function normalizeProject(input: ProjectInput): ProjectInput {
  const folder = input.folder?.trim().replace(/^~(?=\/|$)/, os.homedir());
  if (!input.name?.trim() || !folder || !path.isAbsolute(folder)) throw new Error("A name and absolute folder path are required.");
  if (!["active", "paused", "archived"].includes(input.status)) throw new Error("Invalid project status.");
  let githubUrl = input.githubUrl.trim();
  if (githubUrl) {
    const url = new URL(githubUrl);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || !/^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) throw new Error("Use a GitHub repository URL: https://github.com/owner/repo");
    githubUrl = `https://github.com${url.pathname.replace(/\/$/, "").replace(/\.git$/, "")}`;
  }
  const rawTask = input.todoistTaskId.trim();
  let todoistTaskId = rawTask;
  if (rawTask.includes("://")) {
    const url = new URL(rawTask);
    if (!/(^|\.)todoist\.com$/.test(url.hostname)) throw new Error("Use a Todoist task ID or URL.");
    todoistTaskId = url.searchParams.get("id") || url.pathname.split("/").filter(Boolean).pop() || "";
    // Todoist's human-readable task links end in the task's ID.
    if (todoistTaskId.includes("-")) todoistTaskId = todoistTaskId.split("-").pop()!;
  }
  if (todoistTaskId && !/^[a-zA-Z0-9]+$/.test(todoistTaskId)) throw new Error("Invalid Todoist task ID.");
  const links = input.links.map(link => {
    const url = new URL(link.url.trim());
    if (!["http:", "https:"].includes(url.protocol) || !link.label.trim()) throw new Error("App links need a label and an http(s) URL.");
    return { label: link.label.trim(), url: url.href };
  });
  return { name: input.name.trim(), folder: path.normalize(folder), status: input.status, pinned: !!input.pinned,
    repoId: input.repoId, githubUrl, todoistTaskId, note: input.note?.filePath ? input.note : null, links,
    processIds: [...new Set(input.processIds)], containerNames: [...new Set(input.containerNames)] };
}
export function saveProject(input: ProjectInput, id?: number): Project[] {
  const data = normalizeProject(input);
  const db = getDatabase();
  db.transaction(() => {
    const previous = id === undefined ? undefined : listProjects().find(p => p.id === id);
    if (id !== undefined && !previous) throw new Error("Project no longer exists.");
    const [owner, repo] = data.githubUrl ? new URL(data.githubUrl).pathname.slice(1).split("/") : [undefined, undefined];
    const repos = listGithubRepoSettings();
    const existing = repos.find(r => r.localPath && path.resolve(r.localPath) === data.folder && (r.owner || undefined) === owner && (r.repo || undefined) === repo);
    data.repoId = previous && previous.folder === data.folder && previous.githubUrl === data.githubUrl
      ? previous.repoId
      : existing?.id ?? addGithubRepo({ label: data.name, localPath: data.folder, owner, repo, branch: "" }).at(-1)!.id;
    if (id === undefined) {
      db.prepare("INSERT INTO projects(data, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects))").run(JSON.stringify(data));
    } else db.prepare("UPDATE projects SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
  })();
  return listProjects();
}
export function removeProject(id: number): Project[] {
  getDatabase().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return listProjects();
}
export function reorderProjects(ids: number[]): Project[] {
  const current = listProjects();
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(id => !current.some(p => p.id === id))) throw new Error("Project order must contain every project once.");
  const update = getDatabase().prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
  getDatabase().transaction(() => ids.forEach((id, i) => update.run(i, id)))();
  return listProjects();
}
