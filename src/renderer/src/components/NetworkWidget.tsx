import type { ReactNode } from "react";
import type { NetworkStatsResult, PublicIpResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconRefresh } from "./icons";
import { formatRate } from "../lib/formatStats";

interface NetworkWidgetProps {
  data: NetworkStatsResult | null;
  publicIp: PublicIpResult | null;
  publicIpEnabled: boolean;
  onCheckPublicIpNow: () => Promise<void>;
}

export default function NetworkWidget({
  data,
  publicIp,
  publicIpEnabled,
  onCheckPublicIpNow,
}: NetworkWidgetProps) {
  let pipClassName = "pip";
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Reading network stats…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
    pipClassName = "pip alert";
  } else if (!data.primary) {
    body = <p className="muted">No active network interface found.</p>;
  } else {
    pipClassName = "pip live";
    body = (
      <>
        <div className="row">
          <span className="name">↓ Download</span>
          <span className="status">{formatRate(data.primary.downloadBytesPerSec)}</span>
        </div>
        <div className="row">
          <span className="name">↑ Upload</span>
          <span className="status">{formatRate(data.primary.uploadBytesPerSec)}</span>
        </div>
        <div className="row">
          <span className="name">Private IP</span>
          <span className="status">
            {data.primary.address} ({data.primary.name})
          </span>
        </div>
      </>
    );
  }

  let publicIpRow: ReactNode;
  if (!publicIpEnabled) {
    publicIpRow = <p className="muted">Public IP checks disabled.</p>;
  } else if (!publicIp) {
    publicIpRow = <p className="muted">Checking public IP…</p>;
  } else if (!publicIp.ok) {
    publicIpRow = <p className="muted">{publicIp.reason}</p>;
  } else {
    publicIpRow = (
      <div className="row">
        <span className="name">Public IP</span>
        <span className="status">{publicIp.ip}</span>
      </div>
    );
  }

  return (
    <Panel
      title="Network"
      headerRight={
        <div className="network-head-actions">
          <button
            className="network-refresh-ip"
            onClick={() => void onCheckPublicIpNow()}
            title="Check public IP now"
            disabled={!publicIpEnabled}
          >
            <IconRefresh />
          </button>
          <span className={pipClassName}></span>
        </div>
      }
    >
      {body}
      {publicIpRow}
    </Panel>
  );
}
