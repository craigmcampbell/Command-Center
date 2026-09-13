import { useEffect, useState, type ReactNode } from "react";
import type { NetworkSample, NetworkStatsResult, PublicIpResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconCopy, IconRefresh } from "./icons";
import { formatBytes, formatRate } from "../lib/formatStats";

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
  const [checkingPublicIp, setCheckingPublicIp] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showAllApps, setShowAllApps] = useState(false);
  const [selected, setSelected] = useState("auto");
  const active = selected === "auto" ? data?.primary : data?.interfaces.find((iface) => iface.name === selected);
  const monitoringStatus = !data ? "Reading stats…" : !data.ok ? "Stats unavailable" : !active ? "No interface" : active.downloadBytesPerSec === null ? "Measuring…" : `Monitoring ${active.name}`;
  async function checkPublicIp() {
    setCheckingPublicIp(true);
    setRefreshError(null);
    try {
      await onCheckPublicIpNow();
    } catch {
      setRefreshError("Couldn't refresh public IP. Try again.");
    } finally {
      setCheckingPublicIp(false);
    }
  }
  let pipClassName = "pip";
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Reading network stats…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
    pipClassName = "pip alert";
  } else if (!active) {
    body = <p className="muted">{selected === "auto" ? "Default interface unavailable. Choose an available interface." : "Selected interface disconnected."}</p>;
  } else {
    pipClassName = "pip live";
    body = (
      <>
        <div className="row">
          <span className="name">↓ Download</span>
          <span className="status">{active.downloadBytesPerSec === null ? "Measuring…" : formatRate(active.downloadBytesPerSec)}</span>
        </div>
        <div className="row">
          <span className="name">↑ Upload</span>
          <span className="status">{active.uploadBytesPerSec === null ? "Measuring…" : formatRate(active.uploadBytesPerSec)}</span>
        </div>
        <NetworkGraph history={active.history} />
        <div className="row">
          <span className="name">Session ↓ / ↑</span>
          <span className="status">{formatBytes(active.downloadedBytes)} / {formatBytes(active.uploadedBytes)}</span>
        </div>
        <p className="muted network-caption">Monitoring {active.name} since {new Date(active.sessionStartedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        <div className="row">
          <span className="name">Private IP</span>
          <CopyIp key={active.address} address={active.address} label="private IP" />
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
        {publicIp.ip && <CopyIp key={publicIp.ip} address={publicIp.ip} label="public IP" />}
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
            onClick={() => void checkPublicIp()}
            title={checkingPublicIp ? "Checking public IP…" : "Check public IP now"}
            aria-label={checkingPublicIp ? "Checking public IP" : "Check public IP now"}
            disabled={!publicIpEnabled || checkingPublicIp}
          >
            <IconRefresh />
          </button>
          <span className="network-monitoring-status" title="Status of local interface measurements">
            <span className={pipClassName} aria-hidden="true"></span>
            {monitoringStatus}
          </span>
        </div>
      }
    >
      {data?.ok && data.interfaces.length > 0 && (
        <label className="row">
          <span className="name">Interface</span>
          <select className="network-interface" value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="auto">Automatic{data.primary ? ` (${data.primary.name})` : ""}</option>
            {selected !== "auto" && !active && <option value={selected}>{selected} (disconnected)</option>}
            {data.interfaces.map((iface) => <option key={iface.name} value={iface.name}>{iface.name} · {iface.address}</option>)}
          </select>
        </label>
      )}
      {body}
      {publicIpRow}
      {publicIpEnabled && publicIp && (
        <p className="muted network-caption">
          {publicIp.ok ? "Last checked" : "Last attempted"}{" "}
          <time dateTime={new Date(publicIp.checkedAt).toISOString()}>{new Date(publicIp.checkedAt).toLocaleString()}</time>
          {checkingPublicIp && " · Refreshing…"}
        </p>
      )}
      {refreshError && <p className="muted network-caption" role="status">{refreshError}</p>}
      <div className="network-apps">
        <h3>Top apps · Last 5 min <span className="muted">Ranked by total transfer · All external interfaces</span></h3>
        {!data ? <p className="muted">Reading app bandwidth…</p>
          : !data.apps ? <p className="muted">App bandwidth unavailable.</p>
          : !data.apps.ok ? <p className="muted" title={data.apps.reason}>App bandwidth unavailable: {data.apps.reason}</p>
          : data.apps.warmingUp ? <p className="muted">Measuring app bandwidth…</p>
          : data.apps.processes.length === 0 ? <p className="muted">No app traffic observed in the last five minutes.</p>
          : <>
            <div className="network-app-row muted"><span>Process</span><span>↓ + ↑ Total</span><span>↓ + ↑ Now</span></div>
            {(showAllApps ? data.apps.processes : data.apps.processes.slice(0, 5)).map((app) => (
              <div className="network-app-row" key={`${app.name}.${app.pid}`}>
                <span className="network-app-name" title={`${app.name} (PID ${app.pid}) · ${app.state}`}>
                  {app.name}<small className="muted network-app-state">{app.state === "ended" ? "No longer observed" : app.state === "idle" ? "Idle" : app.state === "measuring" ? "Measuring…" : "Active"}</small>
                </span>
                <span>{formatBytes(app.recentBytes)}</span>
                <span title={`↓ ${formatRate(app.downloadBytesPerSec)} · ↑ ${formatRate(app.uploadBytesPerSec)}`}>
                  {app.state === "ended" || app.state === "measuring" ? "—" : formatRate(app.downloadBytesPerSec + app.uploadBytesPerSec)}
                </span>
              </div>
            ))}
            {data.apps.processes.length > 5 && (
              <button className="network-app-toggle" onClick={() => setShowAllApps((value) => !value)} aria-expanded={showAllApps}>
                {showAllApps ? "Show top five" : `Show all ${data.apps.processes.length} processes`}
              </button>
            )}
            <p className="muted network-caption">Idle and recently ended processes stay visible for five minutes after their last observed transfer.</p>
          </>}
      </div>
    </Panel>
  );
}

function NetworkGraph({ history }: { history: NetworkSample[] }) {
  if (history.length < 2) return <p className="muted network-caption">Collecting traffic history…</p>;
  const end = history[history.length - 1].at;
  const start = end - 5 * 60_000;
  const peakDown = Math.max(...history.map((point) => point.downloadBytesPerSec));
  const peakUp = Math.max(...history.map((point) => point.uploadBytesPerSec));
  const max = Math.max(1, peakDown, peakUp);
  const points = (key: "downloadBytesPerSec" | "uploadBytesPerSec") => history.map((point) =>
    `${((point.at - start) / (end - start)) * 300},${65 - point[key] / max * 60}`
  ).join(" ");
  return (
    <div className="network-graph">
      <div className="network-legend"><span className="network-download">↓ {formatRate(peakDown)} peak</span><span className="network-upload">↑ {formatRate(peakUp)} peak</span></div>
      <svg viewBox="0 0 300 70" role="img" aria-label={`Traffic over the last five minutes. Download peak ${formatRate(peakDown)}, upload peak ${formatRate(peakUp)}.`}>
        <path d="M0 65H300 M0 5H300" className="network-grid" />
        <polyline points={points("downloadBytesPerSec")} className="network-download" />
        <polyline points={points("uploadBytesPerSec")} className="network-upload" strokeDasharray="4 3" />
      </svg>
      <div className="network-legend muted"><span>5 min ago</span><span>Now · interval averages</span></div>
    </div>
  );
}

function CopyIp({ address, label }: { address: string; label: string }) {
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(""), 2500);
    return () => clearTimeout(timeout);
  }, [feedback]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setFeedback("Copied");
    } catch {
      setFeedback("Copy failed");
    }
  }
  return (
    <span className="status network-ip-value">
      <span>{address}</span>
      <button className="network-copy-ip" type="button" onClick={() => void copy()} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
        <IconCopy />
      </button>
      {feedback && <span className="network-copy-feedback" role="status">{feedback}</span>}
    </span>
  );
}
