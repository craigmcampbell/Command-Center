import type { TodoistResult } from "../../../shared/types";
import Panel from "./Panel";
import Row from "./Row";

interface TodoistWidgetProps {
  data: TodoistResult | null;
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

export default function TodoistWidget({ data }: TodoistWidgetProps) {
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
      <Row
        key={t.id}
        dotClassName={t.overdue ? "alert" : "running"}
        name={t.content}
        status={dueLabel(t.due, t.overdue)}
      />
    ));
  }

  return (
    <Panel title="Due & Overdue" headerRight={<span className={pipClassName}></span>}>
      {body}
    </Panel>
  );
}
