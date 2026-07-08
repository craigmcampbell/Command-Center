import type { MissionsResult } from "../../../shared/types";
import Panel from "./Panel";
import Row from "./Row";

interface MissionsWidgetProps {
  data: MissionsResult | null;
}

export default function MissionsWidget({ data }: MissionsWidgetProps) {
  let body;
  if (!data) {
    body = <p className="muted">Reading missions…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}.</p>;
  } else if (data.missions.length === 0) {
    body = <p className="muted">No missions yet.</p>;
  } else {
    body = data.missions.map((m) => {
      const when = new Date(m.modified).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      return <Row key={m.path} dotClassName="running" name={m.name} status={when} />;
    });
  }

  return <Panel title="Active Missions">{body}</Panel>;
}
