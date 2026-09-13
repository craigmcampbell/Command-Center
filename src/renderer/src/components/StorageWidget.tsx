import type { ReactNode } from "react";
import type { StorageStatsResult, StorageVolume } from "../../../shared/types";
import Panel from "./Panel";
import { formatBytes } from "../lib/formatStats";

interface StorageWidgetProps {
  data: StorageStatsResult | null;
}

function VolumeRow({ volume }: { volume: StorageVolume }) {
  const high = volume.usedPercent >= 90;
  return (
    <div className="storage-volume">
      <div className="row">
        <span className={`dot ${high ? "alert" : "running"}`}></span>
        <span className="name">{volume.name}</span>
        <span className="status">
          {formatBytes(volume.usedBytes)} / {formatBytes(volume.totalBytes)} ({volume.usedPercent}%)
        </span>
      </div>
      <div className="storage-bar">
        <div
          className={`storage-bar-fill${high ? " alert" : ""}`}
          style={{ width: `${Math.min(100, volume.usedPercent)}%` }}
        ></div>
      </div>
    </div>
  );
}

export default function StorageWidget({ data }: StorageWidgetProps) {
  let pipClassName = "pip";
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Reading storage…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
    pipClassName = "pip alert";
  } else if (data.volumes.length === 0) {
    body = <p className="muted">No volumes found.</p>;
  } else {
    pipClassName = data.volumes.some((v) => v.usedPercent >= 90) ? "pip alert" : "pip";
    body = data.volumes.map((v) => <VolumeRow key={v.mountPoint} volume={v} />);
  }

  return (
    <Panel title="Storage" headerRight={<span className={pipClassName}></span>}>
      {body}
    </Panel>
  );
}
