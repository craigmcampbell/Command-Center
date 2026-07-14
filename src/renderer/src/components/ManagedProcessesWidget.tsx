import { useEffect, useRef, useState } from "react";
import type { ProcessConfig, ProcessStatus } from "../../../shared/types";
import Panel from "./Panel";
import { IconExternal, IconNote, IconPlay, IconStop } from "./icons";

interface ManagedProcessesWidgetProps {
  configs: ProcessConfig[];
  statuses: ProcessStatus[];
  onRefresh: () => Promise<void>;
}

// How often a row with its logs panel open re-polls for fresher output.
// The app-wide statusAll poll (driven from App.tsx, ~3s) is enough to keep
// pips honest but too slow to feel "live" while actively watching output.
const LOG_POLL_MS = 1500;

function emptyStatus(id: string): ProcessStatus {
  return { id, running: false, exitCode: null, logs: [] };
}

function ProcessRow({
  config,
  status,
  logsOpen,
  onToggleLogs,
  onRefresh,
}: {
  config: ProcessConfig;
  status: ProcessStatus;
  logsOpen: boolean;
  onToggleLogs: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  async function handleToggle() {
    setBusy(true);
    if (status.running) {
      await window.api.process.stop(config.id);
    } else {
      await window.api.process.start(config.id);
    }
    await onRefresh();
    setBusy(false);
  }

  // Auto-scroll to the newest output whenever the tail changes, but only
  // while this row's panel is actually open.
  useEffect(() => {
    if (!logsOpen) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logsOpen, status.logs]);

  const crashed = !status.running && status.exitCode != null && status.exitCode !== 0;
  const dotClass = status.running ? "running" : crashed ? "alert" : "";

  return (
    <div className="process-item">
      <div className="row">
        <span className={`dot ${dotClass}`}></span>
        <span className="name">{config.label}</span>
        {crashed && <span className="tag process-exit">exit {status.exitCode}</span>}
        {config.url && status.running && (
          <button
            className="row-action"
            title="Open in browser"
            onClick={() => window.api.openUrl(config.url!)}
          >
            <IconExternal size={12} />
          </button>
        )}
        <button
          className="desc-toggle"
          onClick={onToggleLogs}
          title={logsOpen ? "Hide logs" : "Show logs"}
        >
          <IconNote />
        </button>
        <button
          className={`docker-toggle ${status.running ? "stop" : ""}`}
          onClick={handleToggle}
          disabled={busy}
          title={status.running ? "Stop" : "Start"}
        >
          {status.running ? <IconStop /> : <IconPlay />}
        </button>
      </div>
      {logsOpen && (
        <div className="process-logs-wrap">
          <pre className="process-logs" ref={logRef}>
            {status.logs.length > 0 ? status.logs.join("") : "No output yet."}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ManagedProcessesWidget({
  configs,
  statuses,
  onRefresh,
}: ManagedProcessesWidgetProps) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [liveStatuses, setLiveStatuses] = useState<Record<string, ProcessStatus>>({});

  function toggleLogs(id: string) {
    setOpenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  useEffect(() => {
    if (openIds.length === 0) {
      setLiveStatuses({});
      return;
    }
    let cancelled = false;
    async function poll() {
      const entries = await Promise.all(
        openIds.map(async (id) => [id, await window.api.process.status(id)] as const)
      );
      if (cancelled) return;
      setLiveStatuses(Object.fromEntries(entries));
    }
    poll();
    const interval = setInterval(poll, LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [openIds]);

  const statusById = new Map(statuses.map((s) => [s.id, s]));

  return (
    <Panel title="Processes">
      {configs.length === 0 ? (
        <p className="muted">No processes configured in config.json.</p>
      ) : (
        configs.map((config) => {
          const base = statusById.get(config.id) ?? emptyStatus(config.id);
          const status = liveStatuses[config.id] ?? base;
          return (
            <ProcessRow
              key={config.id}
              config={config}
              status={status}
              logsOpen={openIds.includes(config.id)}
              onToggleLogs={() => toggleLogs(config.id)}
              onRefresh={onRefresh}
            />
          );
        })
      )}
    </Panel>
  );
}
