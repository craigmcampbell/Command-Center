import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  ActiveTimer,
  TaskTimeSummary,
  TimeEntry,
  TodoistTask,
  TodoistResult,
} from "../../../shared/types";
import Panel from "./Panel";
import TimeReportModal from "./TimeReportModal";
import { formatDuration, todayLocalDateString } from "../lib/time";
import {
  IconCheck,
  IconClock,
  IconExternal,
  IconNote,
  IconPlay,
  IconPlus,
  IconStop,
  IconTrash,
} from "./icons";

interface TodoistWidgetProps {
  data: TodoistResult | null;
  onRefresh: () => Promise<void>;
  showTimeTracking: boolean;
}

function dueLabel(dateStr: string | null, overdue: boolean): string {
  if (!dateStr) return "";
  const today = todayLocalDateString();
  if (dateStr === today) return "Today";
  if (overdue) {
    const days = Math.round(
      (new Date(today).getTime() - new Date(dateStr).getTime()) / 86400000
    );
    return days === 1 ? "Yesterday" : `${days}d overdue`;
  }
  return dateStr;
}

function AddTaskForm({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || submitting) return;

    setSubmitting(true);
    setError(false);
    const res = await window.api.todoist.create(content);
    setSubmitting(false);

    if (res.ok) {
      setText("");
      await onRefresh();
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  }

  return (
    <form className="todoist-add" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder={error ? "Couldn't add task" : "Add a task…"}
        value={text}
        disabled={submitting}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" disabled={!text.trim() || submitting} aria-label="Add task">
        <IconPlus />
      </button>
    </form>
  );
}

// The manual-add form + entry list living inside a task's expand panel.
// Fetches its own entries lazily (only once expanded) and calls back up to
// refresh the row's cumulative badge after any change.
function TimeEntriesPanel({
  task,
  onChanged,
}: {
  task: TodoistTask;
  onChanged: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [date, setDate] = useState(todayLocalDateString);

  const load = useCallback(async () => {
    setEntries(await window.api.timeTracking.entries(task.id));
  }, [task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const mins = Number(minutes);
    if (!mins || mins <= 0) return;
    await window.api.timeTracking.addManual(task.id, task.content, task.project, mins, date);
    setMinutes("");
    setAdding(false);
    await Promise.all([load(), onChanged()]);
  }

  async function handleDelete(entryId: number) {
    await window.api.timeTracking.deleteEntry(entryId, task.id);
    await Promise.all([load(), onChanged()]);
  }

  return (
    <div className="time-entries">
      <div className="time-entries-head">
        <span className="time-entries-title">Time log</span>
        <button type="button" className="time-add-toggle" onClick={() => setAdding((v) => !v)}>
          <IconPlus size={10} /> Add time
        </button>
      </div>
      {adding && (
        <form className="time-add-form" onSubmit={handleAdd}>
          <input
            type="number"
            min={1}
            step={1}
            placeholder="Minutes"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            autoFocus
          />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="submit" disabled={!minutes} aria-label="Save time entry">
            <IconCheck />
          </button>
        </form>
      )}
      {entries === null ? (
        <p className="muted time-entries-empty">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted time-entries-empty">No time logged yet.</p>
      ) : (
        <ul className="time-entries-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="time-entry-date">
                {new Date(entry.startedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span className="time-entry-duration">{formatDuration(entry.durationSeconds)}</span>
              <span className="time-entry-source">{entry.source}</span>
              <button
                type="button"
                className="time-entry-delete"
                onClick={() => handleDelete(entry.id)}
                aria-label="Delete time entry"
              >
                <IconTrash size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TodoistRow({
  task,
  onRefresh,
  showTimeTracking,
  summarySeconds,
  isRunning,
  liveElapsedSeconds,
  onToggleTimer,
  onTimeChanged,
}: {
  task: TodoistTask;
  onRefresh: () => Promise<void>;
  showTimeTracking: boolean;
  summarySeconds: number;
  isRunning: boolean;
  liveElapsedSeconds: number;
  onToggleTimer: (task: TodoistTask) => void;
  onTimeChanged: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);

  async function handleComplete() {
    setCompleting(true);
    const res = await window.api.todoist.complete(task.id);
    if (res.ok) {
      await onRefresh();
    } else {
      setCompleting(false);
    }
  }

  const today = todayLocalDateString();
  const pillVariant = task.overdue ? "alert" : task.due === today ? "today" : "future";
  const hasExpandable = task.description || task.subtasks.length > 0 || showTimeTracking;
  const totalSeconds = summarySeconds + (isRunning ? liveElapsedSeconds : 0);
  const deadlineLabel = task.deadline
    ? new Date(`${task.deadline}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className={`todoist-item ${completing ? "completing" : ""}`}>
      <div className="row">
        <button
          className={`check ${task.overdue ? "alert" : "running"}`}
          disabled={completing}
          onClick={handleComplete}
          title="Mark complete"
        >
          <IconCheck className="check-icon" />
        </button>
        <span className="name link" onClick={() => window.api.openUrl(task.url)}>
          {task.content}
          <IconExternal className="external-icon" />
        </span>
        {task.parentName && (
          <span className="parent-tag" title={task.parentName}>
            ↳ {task.parentName}
          </span>
        )}
        {showTimeTracking && (
          <span className="time-control">
            <button
              type="button"
              className={`time-toggle ${isRunning ? "running" : ""}`}
              onClick={() => onToggleTimer(task)}
              title={isRunning ? "Stop timer" : "Start timer"}
            >
              {isRunning ? <IconStop /> : <IconPlay />}
            </button>
            {totalSeconds > 0 && <span className="time-total">{formatDuration(totalSeconds)}</span>}
          </span>
        )}
        {hasExpandable && (
          <button
            className="desc-toggle"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Hide details" : "Show details"}
          >
            <IconNote />
          </button>
        )}
        <span className="due-meta">
          {task.labels.length > 0 && (
            <span className="tag-chips-inline">
              {task.labels.map((label) => (
                <span key={label} className="tag-chip">
                  {label}
                </span>
              ))}
            </span>
          )}
          {deadlineLabel && (
            <span className="deadline-pill" title={`Deadline: ${task.deadline}`}>
              Deadline {deadlineLabel}
            </span>
          )}
          <span className={`due-pill ${pillVariant}`}>{dueLabel(task.due, task.overdue)}</span>
        </span>
      </div>
      {expanded && (
        <div className="todoist-expand">
          {task.description && <div className="expand-note">{task.description}</div>}
          {task.subtasks.length > 0 && (
            <ul className="todoist-subtasks">
              {task.subtasks.map((s) => (
                <li key={s.id} className={s.checked ? "done" : ""}>
                  {s.content}
                </li>
              ))}
            </ul>
          )}
          {showTimeTracking && <TimeEntriesPanel task={task} onChanged={onTimeChanged} />}
        </div>
      )}
    </div>
  );
}

function groupByProject(tasks: TodoistTask[]): [string, TodoistTask[]][] {
  const groups = new Map<string, TodoistTask[]>();
  for (const task of tasks) {
    const list = groups.get(task.project);
    if (list) {
      list.push(task);
    } else {
      groups.set(task.project, [task]);
    }
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export default function TodoistWidget({ data, onRefresh, showTimeTracking }: TodoistWidgetProps) {
  const [summaries, setSummaries] = useState<Record<string, TaskTimeSummary>>({});
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [reportOpen, setReportOpen] = useState(false);

  const loadTimeState = useCallback(async () => {
    if (!showTimeTracking) {
      setSummaries({});
      setActiveTimer(null);
      return;
    }
    const ids = data?.ok ? data.tasks.map((t) => t.id) : [];
    const [sums, active] = await Promise.all([
      ids.length > 0 ? window.api.timeTracking.summaries(ids) : Promise.resolve({}),
      window.api.timeTracking.activeTimer(),
    ]);
    setSummaries(sums);
    setActiveTimer(active);
  }, [data, showTimeTracking]);

  useEffect(() => {
    void loadTimeState();
  }, [loadTimeState]);

  // Tick once a second while a timer's running so the row's badge and the
  // panel header both show live-updating elapsed time.
  useEffect(() => {
    if (!activeTimer) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  async function handleToggleTimer(task: TodoistTask) {
    if (activeTimer?.taskId === task.id) {
      await window.api.timeTracking.stop();
    } else {
      await window.api.timeTracking.start(task.id, task.content, task.project);
    }
    await loadTimeState();
  }

  let pipClassName = "pip";
  let body;

  if (!data) {
    body = <p className="muted">Loading tasks…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}.</p>;
    pipClassName = "pip alert";
  } else if (data.tasks.length === 0) {
    body = <p className="muted">Nothing due. Clear runway.</p>;
  } else {
    pipClassName = data.tasks.some((t) => t.overdue) ? "pip alert" : "pip live";
    const liveElapsedSeconds = activeTimer ? Math.floor((nowTick - activeTimer.startedAt) / 1000) : 0;
    body = groupByProject(data.tasks).map(([project, tasks]) => (
      <div className="todoist-group" key={project}>
        <h3 className="todoist-group-title">{project}</h3>
        {tasks.map((t) => (
          <TodoistRow
            key={t.id}
            task={t}
            onRefresh={onRefresh}
            showTimeTracking={showTimeTracking}
            summarySeconds={summaries[t.id]?.totalSeconds ?? 0}
            isRunning={activeTimer?.taskId === t.id}
            liveElapsedSeconds={liveElapsedSeconds}
            onToggleTimer={handleToggleTimer}
            onTimeChanged={loadTimeState}
          />
        ))}
      </div>
    ));
  }

  return (
    <Panel
      title="Due & Overdue"
      headerRight={
        <div className="todoist-header-actions">
          {showTimeTracking && (
            <button
              type="button"
              className="report-trigger"
              onClick={() => setReportOpen(true)}
              title="Monthly time report"
            >
              <IconClock size={12} /> Report
            </button>
          )}
          <span className={pipClassName}></span>
        </div>
      }
    >
      <AddTaskForm onRefresh={onRefresh} />
      {body}
      {reportOpen && <TimeReportModal onClose={() => setReportOpen(false)} />}
    </Panel>
  );
}
