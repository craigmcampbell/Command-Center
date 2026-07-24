// Cumulative time tracking against Todoist tasks, for client billing. A row
// only ever gets written here once time is actually logged against a task —
// there's no shadow row for every Todoist task, just the ones someone timed.
// task_content/project_name are snapshotted per entry (not looked up live
// from Todoist) so a monthly report still reads correctly after the task is
// completed or deleted upstream. Only one timer can run at a time — starting
// a new one auto-stops whichever task was previously running.

import { getDatabase } from "./db";
import type {
  ActiveTimer,
  MonthlyReportResult,
  TaskTimeSummary,
  TimeEntry,
} from "../../shared/types";

const ACTIVE_ROW_ID = 1;

export function initTimeTracking(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    task_content TEXT NOT NULL,
    project_name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    source TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries (task_id)`);
  db.exec(`CREATE TABLE IF NOT EXISTS active_timer (
    id INTEGER PRIMARY KEY CHECK (id = ${ACTIVE_ROW_ID}),
    task_id TEXT,
    task_content TEXT,
    project_name TEXT,
    started_at INTEGER
  )`);
  db.prepare(`INSERT OR IGNORE INTO active_timer (id) VALUES (?)`).run(ACTIVE_ROW_ID);
}

interface ActiveTimerRow {
  task_id: string | null;
  task_content: string | null;
  project_name: string | null;
  started_at: number | null;
}

function readActiveRow(): ActiveTimerRow {
  return getDatabase()
    .prepare(
      `SELECT task_id, task_content, project_name, started_at FROM active_timer WHERE id = ?`
    )
    .get(ACTIVE_ROW_ID) as ActiveTimerRow;
}

export function getActiveTimer(): ActiveTimer | null {
  const row = readActiveRow();
  if (!row.task_id || row.started_at == null) return null;
  return {
    taskId: row.task_id,
    taskContent: row.task_content ?? "",
    projectName: row.project_name ?? "",
    startedAt: row.started_at,
  };
}

// Writes a completed span for whatever's currently running (if anything) and
// clears the active-timer row. Internal — callers go through start/stop so
// switching tasks never loses the previous span.
function flushActiveTimer(): void {
  const row = readActiveRow();
  if (!row.task_id || row.started_at == null) return;
  const durationSeconds = Math.max(0, Math.round((Date.now() - row.started_at) / 1000));
  if (durationSeconds > 0) {
    getDatabase()
      .prepare(
        `INSERT INTO time_entries (task_id, task_content, project_name, started_at, duration_seconds, source)
         VALUES (?, ?, ?, ?, ?, 'timer')`
      )
      .run(row.task_id, row.task_content, row.project_name, row.started_at, durationSeconds);
  }
  getDatabase()
    .prepare(
      `UPDATE active_timer SET task_id = NULL, task_content = NULL, project_name = NULL, started_at = NULL
       WHERE id = ?`
    )
    .run(ACTIVE_ROW_ID);
}

export function startTimer(
  taskId: string,
  taskContent: string,
  projectName: string
): ActiveTimer {
  flushActiveTimer(); // only one timer runs at a time — auto-stop whatever was running
  const startedAt = Date.now();
  getDatabase()
    .prepare(
      `UPDATE active_timer SET task_id = ?, task_content = ?, project_name = ?, started_at = ?
       WHERE id = ?`
    )
    .run(taskId, taskContent, projectName, startedAt, ACTIVE_ROW_ID);
  return { taskId, taskContent, projectName, startedAt };
}

export function stopActiveTimer(): void {
  flushActiveTimer();
}

export function addManualEntry(
  taskId: string,
  taskContent: string,
  projectName: string,
  minutes: number,
  date?: string
): TaskTimeSummary {
  const durationSeconds = Math.round(minutes * 60);
  const startedAt = date ? new Date(`${date}T12:00:00`).getTime() : Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO time_entries (task_id, task_content, project_name, started_at, duration_seconds, source)
       VALUES (?, ?, ?, ?, ?, 'manual')`
    )
    .run(taskId, taskContent, projectName, startedAt, durationSeconds);
  return getTaskSummary(taskId);
}

function sumSeconds(taskId: string): number {
  const row = getDatabase()
    .prepare(`SELECT COALESCE(SUM(duration_seconds), 0) as total FROM time_entries WHERE task_id = ?`)
    .get(taskId) as { total: number };
  return row.total;
}

export function getTaskSummary(taskId: string): TaskTimeSummary {
  const active = getActiveTimer();
  return {
    taskId,
    totalSeconds: sumSeconds(taskId),
    runningSince: active?.taskId === taskId ? active.startedAt : null,
  };
}

export function getTaskSummaries(taskIds: string[]): Record<string, TaskTimeSummary> {
  if (taskIds.length === 0) return {};
  const db = getDatabase();
  const placeholders = taskIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT task_id as taskId, COALESCE(SUM(duration_seconds), 0) as total
       FROM time_entries WHERE task_id IN (${placeholders}) GROUP BY task_id`
    )
    .all(...taskIds) as { taskId: string; total: number }[];
  const totals = new Map(rows.map((r) => [r.taskId, r.total]));
  const active = getActiveTimer();
  const result: Record<string, TaskTimeSummary> = {};
  for (const taskId of taskIds) {
    result[taskId] = {
      taskId,
      totalSeconds: totals.get(taskId) ?? 0,
      runningSince: active?.taskId === taskId ? active.startedAt : null,
    };
  }
  return result;
}

interface TimeEntryRow {
  id: number;
  task_id: string;
  task_content: string;
  project_name: string;
  started_at: number;
  duration_seconds: number;
  source: string;
}

function rowToEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    taskContent: row.task_content,
    projectName: row.project_name,
    startedAt: row.started_at,
    durationSeconds: row.duration_seconds,
    source: row.source === "manual" ? "manual" : "timer",
  };
}

export function listEntries(taskId: string): TimeEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, task_id, task_content, project_name, started_at, duration_seconds, source
       FROM time_entries WHERE task_id = ? ORDER BY started_at DESC`
    )
    .all(taskId) as TimeEntryRow[];
  return rows.map(rowToEntry);
}

export function deleteEntry(entryId: number, taskId: string): TaskTimeSummary {
  getDatabase().prepare(`DELETE FROM time_entries WHERE id = ?`).run(entryId);
  return getTaskSummary(taskId);
}

interface TaskAccumulator {
  taskId: string;
  taskContent: string;
  projectName: string;
  totalSeconds: number;
}

// Monthly report for client billing — every entry that started in the given
// calendar month (local time), grouped by project then task. task_content/
// project_name come from the latest entry in the group (ascending scan, last
// write wins) so a task renamed mid-month shows its most recent name.
export function getMonthlyReport(month: string): MonthlyReportResult {
  const rows = getDatabase()
    .prepare(
      `SELECT task_id, task_content, project_name, duration_seconds
       FROM time_entries
       WHERE strftime('%Y-%m', started_at / 1000, 'unixepoch', 'localtime') = ?
       ORDER BY started_at ASC`
    )
    .all(month) as {
    task_id: string;
    task_content: string;
    project_name: string;
    duration_seconds: number;
  }[];

  const byTask = new Map<string, TaskAccumulator>();
  for (const row of rows) {
    const existing = byTask.get(row.task_id);
    if (existing) {
      existing.totalSeconds += row.duration_seconds;
      existing.taskContent = row.task_content;
      existing.projectName = row.project_name;
    } else {
      byTask.set(row.task_id, {
        taskId: row.task_id,
        taskContent: row.task_content,
        projectName: row.project_name,
        totalSeconds: row.duration_seconds,
      });
    }
  }

  const byProject = new Map<
    string,
    { totalSeconds: number; tasks: { taskId: string; taskContent: string; totalSeconds: number }[] }
  >();
  for (const t of byTask.values()) {
    const taskEntry = { taskId: t.taskId, taskContent: t.taskContent, totalSeconds: t.totalSeconds };
    const group = byProject.get(t.projectName);
    if (group) {
      group.totalSeconds += t.totalSeconds;
      group.tasks.push(taskEntry);
    } else {
      byProject.set(t.projectName, { totalSeconds: t.totalSeconds, tasks: [taskEntry] });
    }
  }

  const projects = Array.from(byProject.entries())
    .map(([projectName, group]) => ({
      projectName,
      totalSeconds: group.totalSeconds,
      tasks: group.tasks.sort((a, b) => b.totalSeconds - a.totalSeconds),
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));

  const totalSeconds = projects.reduce((sum, p) => sum + p.totalSeconds, 0);

  return { month, totalSeconds, projects };
}
