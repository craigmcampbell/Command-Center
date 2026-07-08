// Talks to the Todoist API (v1) for due/overdue tasks and for completing or
// creating them. Requires a personal API token (Todoist Settings ->
// Integrations -> Developer) stored in config.json. Fails soft, like the
// other services, so a missing/bad token just shows a friendly message
// instead of crashing the widget.

import type { AppConfig, ActionResult, TodoistResult } from "../../shared/types";

const API_ROOT = "https://api.todoist.com/api/v1";
const TASKS_URL =
  `${API_ROOT}/tasks/filter?query=` + encodeURIComponent("overdue | today");
const PROJECTS_URL = `${API_ROOT}/projects`;
const ALL_TASKS_URL = `${API_ROOT}/tasks`;

export async function getDueTasks(
  { apiToken }: AppConfig["todoist"] = { apiToken: "" }
): Promise<TodoistResult> {
  if (!apiToken) {
    return { ok: false, reason: "No Todoist API token configured", tasks: [] };
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
    return { ok: false, reason: "Couldn't reach Todoist", tasks: [] };
  }

  const failed = !tasksRes.ok ? tasksRes : !projectsRes.ok ? projectsRes : !allTasksRes.ok ? allTasksRes : null;
  if (failed) {
    return {
      ok: false,
      reason: failed.status === 401 ? "Todoist token rejected" : "Todoist request failed",
      tasks: [],
    };
  }

  const { results } = await tasksRes.json();
  const { results: projects } = await projectsRes.json();
  const { results: allTasks } = await allTasksRes.json();

  const projectNames = new Map<string, string>(
    projects.map((p: any) => [p.id, p.name])
  );
  const subtasksByParent = new Map<string, any[]>();
  for (const t of allTasks) {
    if (t.parent_id) {
      const list = subtasksByParent.get(t.parent_id);
      if (list) list.push(t);
      else subtasksByParent.set(t.parent_id, [t]);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  const tasks = results
    .map((t: any) => ({
      id: t.id,
      content: t.content,
      description: t.description || "",
      url: `https://app.todoist.com/app/task/${t.id}`,
      priority: t.priority, // 4 = highest (p1), 1 = lowest (p4)
      due: t.due?.date || null,
      overdue: !!t.due?.date && t.due.date < today,
      project: projectNames.get(t.project_id) || "Inbox",
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

  return { ok: true, tasks };
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
  content: string
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
      body: JSON.stringify({ content, due_string: "today" }),
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
