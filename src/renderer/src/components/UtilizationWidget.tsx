import type { ReactNode } from "react";
import Panel from "./Panel";
import Sparkline from "./Sparkline";

interface UtilizationWidgetProps {
  title: string;
  // null percent means "still loading" (data not fetched yet) rather than
  // an error — ok=false with a reason is the actual failure state.
  percent: number | null;
  history: number[];
  ok: boolean;
  reason?: string;
}

// Same three-tier severity used by the Storage widget's usage bar and the
// System widget's pip: --live (normal) -> --pending (elevated) -> --alert
// (critical), rather than the brand --accent, matching this app's existing
// status-color convention.
function severityColor(percent: number): string {
  if (percent >= 90) return "var(--alert)";
  if (percent >= 75) return "var(--pending)";
  return "var(--live)";
}

export default function UtilizationWidget({
  title,
  percent,
  history,
  ok,
  reason,
}: UtilizationWidgetProps) {
  let pipClassName = "pip";
  let body: ReactNode;

  if (!ok) {
    body = <p className="muted">{reason}</p>;
    pipClassName = "pip alert";
  } else if (percent === null) {
    body = <p className="muted">Reading…</p>;
  } else {
    const color = severityColor(percent);
    pipClassName = percent >= 90 ? "pip alert" : percent >= 75 ? "pip live" : "pip";
    body = (
      <div className="utilization-tile">
        <div className="utilization-value" style={{ color }}>
          {percent.toFixed(0)}%
        </div>
        <Sparkline values={history} color={color} />
      </div>
    );
  }

  return (
    <Panel title={title} headerRight={<span className={pipClassName}></span>}>
      {body}
    </Panel>
  );
}
