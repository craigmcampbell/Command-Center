import type { ReactNode } from "react";
import type { DockerResult } from "../../../shared/types";
import Panel from "./Panel";
import Row from "./Row";

interface DockerWidgetProps {
  data: DockerResult | null;
}

export default function DockerWidget({ data }: DockerWidgetProps) {
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
      <Row
        key={c.name}
        dotClassName={c.state === "running" ? "running" : ""}
        name={c.name}
        status={c.status}
      />
    ));
  }

  return (
    <Panel title="Services" headerRight={<span className={pipClassName}></span>}>
      {body}
    </Panel>
  );
}
