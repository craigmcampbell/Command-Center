import type { ReactNode } from "react";
import type { TopMemoryProcess, TopProcessesResult } from "../../../shared/types";
import Panel from "./Panel";
import { formatBytes } from "../lib/formatStats";

interface TopProcessesWidgetProps {
  data: TopProcessesResult | null;
}

function ProcessRow({ process, rank }: { process: TopMemoryProcess; rank: number }) {
  return (
    <div className="row">
      <span className="process-rank">{rank}</span>
      <span className="name" title={process.name}>
        {process.name}
      </span>
      <span className="status">
        {formatBytes(process.memoryBytes)} ({process.memoryPercent.toFixed(1)}%)
      </span>
    </div>
  );
}

export default function TopProcessesWidget({ data }: TopProcessesWidgetProps) {
  let pipClassName = "pip";
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Reading processes…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
    pipClassName = "pip alert";
  } else if (data.processes.length === 0) {
    body = <p className="muted">No process data available.</p>;
  } else {
    body = data.processes.map((p, i) => <ProcessRow key={p.pid} process={p} rank={i + 1} />);
  }

  return (
    <Panel title="Top Processes (Memory)" headerRight={<span className={pipClassName}></span>}>
      {body}
    </Panel>
  );
}
