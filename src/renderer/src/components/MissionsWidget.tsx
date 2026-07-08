import type { MissionsResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconArrowRight } from "./icons";

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
    body = data.missions.map((m) => (
      <button
        key={m.path}
        className="launch"
        onClick={() => window.api.openUrl(m.obsidianUri)}
      >
        <span>{m.name}</span>
        <span className="arrow">
          {m.tags.join(", ")}
          <IconArrowRight />
        </span>
      </button>
    ));
  }

  return <Panel title="Active Missions">{body}</Panel>;
}
