import { useState } from "react";
import type { ReactNode } from "react";
import type { DockerContainer, DockerResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconPlay, IconStop } from "./icons";

interface DockerWidgetProps {
  data: DockerResult | null;
  onRefresh: () => Promise<void>;
}

function DockerRow({
  container,
  onRefresh,
}: {
  container: DockerContainer;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const running = container.state === "running";

  async function handleToggle() {
    setBusy(true);
    const res = running
      ? await window.api.docker.stop(container.name)
      : await window.api.docker.start(container.name);
    if (res.ok) await onRefresh();
    setBusy(false);
  }

  return (
    <div className="row">
      <span className={`dot ${running ? "running" : ""}`}></span>
      <span className="name">{container.name}</span>
      <span className="status">{container.status}</span>
      <button
        className={`docker-toggle ${running ? "stop" : ""}`}
        onClick={handleToggle}
        disabled={busy}
        title={running ? "Stop container" : "Start container"}
      >
        {running ? <IconStop /> : <IconPlay />}
      </button>
    </div>
  );
}

export default function DockerWidget({ data, onRefresh }: DockerWidgetProps) {
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
      <DockerRow key={c.name} container={c} onRefresh={onRefresh} />
    ));
  }

  return (
    <Panel title="Services" headerRight={<span className={pipClassName}></span>}>
      {body}
    </Panel>
  );
}
