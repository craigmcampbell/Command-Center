import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import type {
  ActiveTimer,
  TaskTimeSummary,
  TimeEntry,
  TodoistProject,
  TodoistTask,
  TodoistResult,
} from "../../../shared/types";
import Panel from "./Panel";
import Select from "./Select";
import TimeReportModal from "./TimeReportModal";
import { formatDuration, todayLocalDateString } from "../lib/time";
import { renderMarkdown } from "../lib/markdown";
import { handleMarkdownPreviewClick } from "../lib/markdownPreviewInteractions";
import {
  IconCheck,
  IconClock,
  IconExternal,
  IconFolder,
  IconNote,
  IconPlay,
  IconPlus,
  IconStop,
  IconTrash,
  IconX,
} from "./icons";

interface TodoistWidgetProps {
  data: TodoistResult | null;
  onRefresh: () => Promise<void>;
  showTimeTracking: boolean;
}

function dueLabel(dateStr: string | null, overdue: boolean): string {
  if (!dateStr) return "No due date";
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

// Defaults to the Inbox project when one exists among the loaded projects;
// falls back to the first project (still explicit, just not literally named
// "Inbox") if a workspace has renamed or lacks one.
function defaultProjectId(projects: TodoistProject[]): string {
  const inbox = projects.find((p) => p.name.toLowerCase() === "inbox");
  return inbox?.id ?? projects[0]?.id ?? "";
}

function AddTaskForm({
  onRefresh,
  projects,
}: {
  onRefresh: () => Promise<void>;
  projects: TodoistProject[];
}) {
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState(() => defaultProjectId(projects));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  // `projects` arrives async (widget mounts before the first Todoist fetch
  // resolves), so the Inbox default above often has nothing to pick from yet
  // — fill it in once the list shows up.
  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(defaultProjectId(projects));
  }, [projects, projectId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || submitting) return;

    setSubmitting(true);
    setError(false);
    const res = await window.api.todoist.create(content, projectId || undefined);
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
      {projects.length > 0 && (
        <Select
          className="todoist-add-project"
          value={projectId}
          disabled={submitting}
          onChange={setProjectId}
          title="Project"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
        />
      )}
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

// The due-pill itself doubles as the trigger — click it to swap in a native
// date input plus a clear button. Each change commits immediately (no
// separate save step), same as YnabUnapprovedWidget's CategoryPicker.
function DueDateControl({
  task,
  pillVariant,
  onRefresh,
}: {
  task: TodoistTask;
  pillVariant: string;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function commit(date: string | null) {
    setSaving(true);
    setEditing(false);
    const res = await window.api.todoist.setDueDate(task.id, date);
    if (res.ok) await onRefresh();
    else setSaving(false);
  }

  if (editing) {
    return (
      <span className="due-edit">
        <input
          type="date"
          defaultValue={task.due ?? ""}
          autoFocus
          disabled={saving}
          onChange={(e) => e.target.value && commit(e.target.value)}
          onBlur={() => setEditing(false)}
        />
        <button
          type="button"
          className="due-edit-clear"
          // Without this, the input's onBlur (which closes the editor) fires
          // before this button's onClick — the button unmounts mid-click and
          // the clear never happens. preventDefault on mousedown keeps focus
          // on the input so blur doesn't fire first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commit(null)}
          disabled={saving}
          title="Clear due date"
        >
          <IconX size={10} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`due-pill due-pill-button ${pillVariant}`}
      onClick={() => setEditing(true)}
      title="Change due date"
    >
      {dueLabel(task.due, task.overdue)}
    </button>
  );
}

// Portal dropdown for moving a task to a different Todoist project — same
// click-outside/scroll-to-close mechanics as YnabUnapprovedWidget's
// CategoryPicker, reusing its .ynab-category-* dropdown styling since the
// shape (searchable flat list in a floating panel) is identical.
function ProjectMoveControl({
  task,
  projects,
  onRefresh,
}: {
  task: TodoistTask;
  projects: TodoistProject[];
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function openDropdown() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) });
    setQuery("");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  async function handleSelect(projectId: string) {
    setOpen(false);
    if (projectId === task.projectId) return;
    setSaving(true);
    const res = await window.api.todoist.move(task.id, projectId);
    if (res.ok) await onRefresh();
    else setSaving(false);
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="desc-toggle"
        onClick={openDropdown}
        disabled={saving || projects.length === 0}
        title="Move to project"
      >
        <IconFolder />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            className="ynab-category-dropdown"
            ref={dropdownRef}
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            <input
              className="ynab-category-input"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects…"
            />
            {filtered.length === 0 ? (
              <div className="ynab-category-empty">No matches</div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`ynab-category-option ${p.id === task.projectId ? "selected" : ""}`}
                  onClick={() => handleSelect(p.id)}
                >
                  {p.name}
                </button>
              ))
            )}
          </div>,
          document.body
        )}
    </>
  );
}

function TodoistRow({
  task,
  projects,
  onRefresh,
  showTimeTracking,
  summarySeconds,
  isRunning,
  liveElapsedSeconds,
  onToggleTimer,
  onTimeChanged,
}: {
  task: TodoistTask;
  projects: TodoistProject[];
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
  const hasNoteContent = !!task.description || summarySeconds > 0;
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
            className={`desc-toggle ${hasNoteContent ? "has-note" : ""}`}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Hide details" : "Show details"}
          >
            <IconNote />
          </button>
        )}
        <ProjectMoveControl task={task} projects={projects} onRefresh={onRefresh} />
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
          <DueDateControl task={task} pillVariant={pillVariant} onRefresh={onRefresh} />
        </span>
      </div>
      {expanded && (
        <div className="todoist-expand">
          {task.description && (
            <div
              className="expand-note note"
              onClick={(e) => handleMarkdownPreviewClick(e, {})}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(task.description) }}
            />
          )}
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
            projects={data.projects}
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
      <AddTaskForm onRefresh={onRefresh} projects={data?.ok ? data.projects : []} />
      {body}
      {reportOpen && <TimeReportModal onClose={() => setReportOpen(false)} />}
    </Panel>
  );
}
