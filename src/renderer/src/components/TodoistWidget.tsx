import { useState } from "react";
import type { FormEvent } from "react";
import type { TodoistTask, TodoistResult } from "../../../shared/types";
import Panel from "./Panel";

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
      <button type="submit" disabled={!text.trim() || submitting}>
        +
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

  return (
    <div className="todoist-item">
      <div className="row">
        <button
          className={`check ${task.overdue ? "alert" : "running"}`}
          disabled={completing}
          onClick={handleComplete}
          title="Mark complete"
        ></button>
        <span className="name link" onClick={() => window.api.openUrl(task.url)}>
          {task.content}
        </span>
        {task.description && (
          <button
            className="desc-toggle"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Hide description" : "Show description"}
          >
            📝
          </button>
        )}
        <span className="status">{dueLabel(task.due, task.overdue)}</span>
      </div>
      {expanded && <div className="todoist-desc">{task.description}</div>}
    </div>
  );
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
    body = data.tasks.map((t) => (
      <TodoistRow key={t.id} task={t} onRefresh={onRefresh} />
    ));
  }

  return (
    <Panel title="Due & Overdue" headerRight={<span className={pipClassName}></span>}>
      <AddTaskForm onRefresh={onRefresh} />
      {body}
    </Panel>
  );
}
