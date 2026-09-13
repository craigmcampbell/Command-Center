import type { ReactNode } from "react";
import type { SystemStatsResult } from "../../../shared/types";
import Panel from "./Panel";
import { formatBytes, formatUptime } from "../lib/formatStats";

interface SystemStatsWidgetProps {
  data: SystemStatsResult | null;
}

export default function SystemStatsWidget({ data }: SystemStatsWidgetProps) {
  let pipClassName = "pip";
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Reading system stats…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
    pipClassName = "pip alert";
  } else {
    const memUsedPercent = Math.round((data.memory.usedBytes / data.memory.totalBytes) * 100);
    pipClassName = data.cpuPercent > 90 || memUsedPercent > 90 ? "pip live" : "pip";
    body = (
      <>
        <div className="row">
          <span className="name">CPU</span>
          <span className="status">{data.cpuPercent.toFixed(0)}%</span>
        </div>
        <div className="row">
          <span className="name">Load average</span>
          <span className="status">
            {data.loadAvg.map((n) => n.toFixed(2)).join(" · ")}
          </span>
        </div>
        <div className="row">
          <span className="name">Uptime</span>
          <span className="status">{formatUptime(data.uptimeSeconds)}</span>
        </div>
        <div className="row">
          <span className="name">Memory</span>
          <span className="status">
            {formatBytes(data.memory.usedBytes)} / {formatBytes(data.memory.totalBytes)}
          </span>
        </div>
        <div className="row">
          <span className="name">Cached · Swap used</span>
          <span className="status">
            {formatBytes(data.memory.cachedBytes)} · {formatBytes(data.memory.swapUsedBytes)}
          </span>
        </div>
        {data.battery && (
          <div className="row">
            <span className="name">Battery</span>
            <span className="status">
              {data.battery.percent}%{data.battery.charging ? " · charging" : ""} ·{" "}
              {data.battery.powerSource}
            </span>
          </div>
        )}
      </>
    );
  }

  return (
    <Panel title="System" headerRight={<span className={pipClassName}></span>}>
      {body}
    </Panel>
  );
}
