import { useState } from "react";
import type { ReactNode } from "react";
import type { DockerContainer, DockerResult, DockerUpdateCheckResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconArrowUp, IconPlay, IconRefresh, IconStop } from "./icons";

interface DockerWidgetProps {
  data: DockerResult | null;
  updates: DockerUpdateCheckResult | null;
  onRefresh: () => Promise<void>;
  onCheckUpdatesNow: () => Promise<void>;
}

function DockerRow({
  container,
  updateStatus,
  onRefresh,
  onCheckUpdatesNow,
}: {
  container: DockerContainer;
  updateStatus?: DockerUpdateCheckResult["images"][number];
  onRefresh: () => Promise<void>;
  onCheckUpdatesNow: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateFailedHard, setUpdateFailedHard] = useState(false);
  const running = container.state === "running";
  const updateAvailable = updateStatus?.status === "updateAvailable";

  async function handleToggle() {
    setBusy(true);
    const res = running
      ? await window.api.docker.stop(container.name)
      : await window.api.docker.start(container.name);
    if (res.ok) await onRefresh();
    setBusy(false);
  }

  async function handleUpdate() {
    setBusy(true);
    setUpdateError(null);
    setUpdateFailedHard(false);
    const res = await window.api.docker.update(container.name);
    if (!res.ok) {
      setUpdateError(res.reason ?? "Update failed");
      setUpdateFailedHard(res.rolledBack === false);
    }
    await onRefresh();
    await onCheckUpdatesNow();
    setBusy(false);
  }

  return (
    <>
      <div className="row">
        <span className={`dot ${running ? "running" : ""}`}></span>
        <span className="name">{container.name}</span>
        <span className="status">{container.status}</span>
        {updateAvailable && (
          <button
            className="docker-update"
            onClick={handleUpdate}
            disabled={busy}
            title="Update available — stop, pull latest, and restart"
          >
            <IconArrowUp />
          </button>
        )}
        <button
          className={`docker-toggle ${running ? "stop" : ""}`}
          onClick={handleToggle}
          disabled={busy}
          title={running ? "Stop container" : "Start container"}
        >
          {running ? <IconStop /> : <IconPlay />}
        </button>
      </div>
      {updateError && (
        <p className={updateFailedHard ? "docker-update-error alert" : "docker-update-error"}>
          {updateError}
        </p>
      )}
    </>
  );
}

export default function DockerWidget({
  data,
  updates,
  onRefresh,
  onCheckUpdatesNow,
}: DockerWidgetProps) {
  let pipClassName = "pip";
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Checking Docker…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}. Start Docker to see services.</p>;
    pipClassName = "pip alert";
  } else if (data.containers.length === 0) {
    body = <p className="muted">No containers. Run something to see it here.</p>;
  } else {
    const anyRunning = data.containers.some((c) => c.state === "running");
    pipClassName = anyRunning ? "pip live" : "pip";
    body = data.containers.map((c) => (
      <DockerRow
        key={c.name}
        container={c}
        updateStatus={updates?.images.find((i) => i.image === c.image)}
        onRefresh={onRefresh}
        onCheckUpdatesNow={onCheckUpdatesNow}
      />
    ));
  }

  return (
    <Panel
      title="Services"
      headerRight={
        <div className="docker-head-actions">
          <button
            className="docker-check-updates"
            onClick={() => void onCheckUpdatesNow()}
            title="Check for image updates now"
          >
            <IconRefresh />
          </button>
          <span className={pipClassName}></span>
        </div>
      }
    >
      {body}
    </Panel>
  );
}
