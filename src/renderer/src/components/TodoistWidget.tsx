import { useState } from "react";
import type { FormEvent } from "react";
import type { TodoistTask, TodoistResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconCheck, IconExternal, IconNote, IconPlus } from "./icons";

interface TodoistWidgetProps {
  data: TodoistResult | null;
  onRefresh: () => Promise<void>;
}

function dueLabel(dateStr: string | null, overdue: boolean): string {
  if (!dateStr) return "";
  const today = new Date().toISOString().slice(0, 10);
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

function TodoistRow({
  task,
  onRefresh,
}: {
  task: TodoistTask;
  onRefresh: () => Promise<void>;
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

  const today = new Date().toISOString().slice(0, 10);
  const pillVariant = task.overdue ? "alert" : task.due === today ? "today" : "future";
  const hasExpandable = task.description || task.subtasks.length > 0;

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

export default function TodoistWidget({ data, onRefresh }: TodoistWidgetProps) {
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
    body = groupByProject(data.tasks).map(([project, tasks]) => (
      <div className="todoist-group" key={project}>
        <h3 className="todoist-group-title">{project}</h3>
        {tasks.map((t) => (
          <TodoistRow key={t.id} task={t} onRefresh={onRefresh} />
        ))}
      </div>
    ));
  }

  return (
    <Panel title="Due & Overdue" headerRight={<span className={pipClassName}></span>}>
      <AddTaskForm onRefresh={onRefresh} />
      {body}
    </Panel>
  );
}
