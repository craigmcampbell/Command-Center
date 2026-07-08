// Talks to the Todoist REST API (v1) for due and overdue tasks. Requires a
// personal API token (Todoist Settings -> Integrations -> Developer) stored
// in config.json. Fails soft, like the other services, so a missing/bad
// token just shows a friendly message instead of crashing the widget.

import type { AppConfig, TodoistResult } from "../../shared/types";

const TASKS_URL =
  "https://api.todoist.com/api/v1/tasks/filter?query=" +
  encodeURIComponent("overdue | today");

export async function getDueTasks(
  { apiToken }: AppConfig["todoist"] = { apiToken: "" }
): Promise<TodoistResult> {
  if (!apiToken) {
    return { ok: false, reason: "No Todoist API token configured", tasks: [] };
  }

  let res: Response;
  try {
    res = await fetch(TASKS_URL, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
  } catch {
    return { ok: false, reason: "Couldn't reach Todoist", tasks: [] };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason:
        res.status === 401 ? "Todoist token rejected" : "Todoist request failed",
      tasks: [],
    };
  }

  const { results } = await res.json();
  const today = new Date().toISOString().slice(0, 10);

  const tasks = results
    .map((t: any) => ({
      id: t.id,
      content: t.content,
      priority: t.priority, // 4 = highest (p1), 1 = lowest (p4)
      due: t.due?.date || null,
      overdue: !!t.due?.date && t.due.date < today,
    }))
    .sort((a: { due: string | null }, b: { due: string | null }) =>
      (a.due || "").localeCompare(b.due || "")
    );

  return { ok: true, tasks };
}
