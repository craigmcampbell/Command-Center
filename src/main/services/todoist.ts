// Talks to the Todoist API (v1) for due/overdue tasks and for completing or
// creating them. Requires a personal API token (Todoist Settings ->
// Integrations -> Developer) stored in config.json. Fails soft, like the
// other services, so a missing/bad token just shows a friendly message
// instead of crashing the widget.

import { randomUUID } from "node:crypto";
import type { AppConfig, ActionResult, TodoistResult } from "../../shared/types";

// `new Date().toISOString().slice(0, 10)` gives the UTC calendar date, which
// is a day ahead of local for anyone west of UTC in the evening — a task due
// "today" (local) then reads as overdue. Build the date from local
// getters instead so "today" always matches the user's own calendar day.
function todayLocalDateString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const API_ROOT = "https://api.todoist.com/api/v1";
const TASKS_URL =
  `${API_ROOT}/tasks/filter?query=` + encodeURIComponent("overdue | today");
const PROJECTS_URL = `${API_ROOT}/projects`;
const ALL_TASKS_URL = `${API_ROOT}/tasks`;

export async function getDueTasks(
  { apiToken }: AppConfig["todoist"] = { apiToken: "" }
): Promise<TodoistResult> {
  if (!apiToken) {
    return { ok: false, reason: "No Todoist API token configured", tasks: [], projects: [] };
  }

  let tasksRes: Response;
  let projectsRes: Response;
  let allTasksRes: Response;
  try {
    [tasksRes, projectsRes, allTasksRes] = await Promise.all([
      fetch(TASKS_URL, { headers: { Authorization: `Bearer ${apiToken}` } }),
      fetch(PROJECTS_URL, { headers: { Authorization: `Bearer ${apiToken}` } }),
      fetch(ALL_TASKS_URL, { headers: { Authorization: `Bearer ${apiToken}` } }),
    ]);
  } catch {
    return { ok: false, reason: "Couldn't reach Todoist", tasks: [], projects: [] };
  }

  const failed = !tasksRes.ok ? tasksRes : !projectsRes.ok ? projectsRes : !allTasksRes.ok ? allTasksRes : null;
  if (failed) {
    return {
      ok: false,
      reason: failed.status === 401 ? "Todoist token rejected" : "Todoist request failed",
      tasks: [],
      projects: [],
    };
  }

  const { results } = await tasksRes.json();
  const { results: projects } = await projectsRes.json();
  const { results: allTasks } = await allTasksRes.json();

  const projectNames = new Map<string, string>(
    projects.map((p: any) => [p.id, p.name])
  );
  const contentById = new Map<string, string>(allTasks.map((t: any) => [t.id, t.content]));
  const subtasksByParent = new Map<string, any[]>();
  for (const t of allTasks) {
    if (t.parent_id) {
      const list = subtasksByParent.get(t.parent_id);
      if (list) list.push(t);
      else subtasksByParent.set(t.parent_id, [t]);
    }
  }

  const today = todayLocalDateString();

  const tasks = results
    .map((t: any) => ({
      id: t.id,
      content: t.content,
      description: t.description || "",
      url: `https://app.todoist.com/app/task/${t.id}`,
      priority: t.priority, // 4 = highest (p1), 1 = lowest (p4)
      due: t.due?.date || null,
      overdue: !!t.due?.date && t.due.date < today,
      deadline: t.deadline?.date || null,
      project: projectNames.get(t.project_id) || "Inbox",
      projectId: t.project_id,
      parentName: t.parent_id ? contentById.get(t.parent_id) || null : null,
      subtasks: (subtasksByParent.get(t.id) || []).map((s: any) => ({
        id: s.id,
        content: s.content,
        checked: !!s.checked,
      })),
      labels: t.labels || [],
    }))
    .sort((a: { due: string | null }, b: { due: string | null }) =>
      (a.due || "").localeCompare(b.due || "")
    );

  const projectList = projects
    .map((p: any) => ({ id: p.id, name: p.name }))
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

  return { ok: true, tasks, projects: projectList };
}

// date is an ISO "YYYY-MM-DD" to set/change the due date, or null to clear
// it entirely. Clearing goes through the Sync API's item_update instead of
// the plain REST tasks endpoint — empirically, POSTing `due_string: null` (or
// due_date/due_datetime) to /tasks/{id} is silently ignored (the due date is
// left unchanged), even though it returns 200. Only the Sync API's `due:
// null` on item_update is documented, and confirmed, to actually remove it.
export async function setTaskDueDate(
  { apiToken }: AppConfig["todoist"],
  taskId: string,
  date: string | null
): Promise<ActionResult> {
  if (!apiToken) {
    return { ok: false, reason: "No Todoist API token configured" };
  }

  try {
    const res = date
      ? await fetch(`${API_ROOT}/tasks/${taskId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ due_date: date }),
        })
      : await fetch(`${API_ROOT}/sync`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            commands: [
              { type: "item_update", uuid: randomUUID(), args: { id: taskId, due: null } },
            ],
          }),
        });
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 401 ? "Todoist token rejected" : "Todoist rejected the request",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Couldn't reach Todoist" };
  }
}

export async function moveTask(
  { apiToken }: AppConfig["todoist"],
  taskId: string,
  projectId: string
): Promise<ActionResult> {
  if (!apiToken) {
    return { ok: false, reason: "No Todoist API token configured" };
  }

  try {
    const res = await fetch(`${API_ROOT}/tasks/${taskId}/move`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 401 ? "Todoist token rejected" : "Todoist rejected the request",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Couldn't reach Todoist" };
  }
}

export async function completeTask(
  { apiToken }: AppConfig["todoist"],
  taskId: string
): Promise<ActionResult> {
  if (!apiToken) {
    return { ok: false, reason: "No Todoist API token configured" };
  }

  try {
    const res = await fetch(`${API_ROOT}/tasks/${taskId}/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 401 ? "Todoist token rejected" : "Todoist rejected the request",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Couldn't reach Todoist" };
  }
}

export async function createTask(
  { apiToken }: AppConfig["todoist"],
  content: string,
  projectId?: string
): Promise<ActionResult> {
  if (!apiToken) {
    return { ok: false, reason: "No Todoist API token configured" };
  }

  try {
    const res = await fetch(`${API_ROOT}/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      // Default new tasks to "today" so they actually show up in this
      // due/overdue widget instead of vanishing into the inbox with no date.
      // Omitting project_id leaves Todoist's own default (Inbox) in place.
      body: JSON.stringify({
        content,
        due_string: "today",
        ...(projectId ? { project_id: projectId } : {}),
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 401 ? "Todoist token rejected" : "Todoist rejected the request",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Couldn't reach Todoist" };
  }
}
