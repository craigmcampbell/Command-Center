import type { LinkInstance } from "../../../shared/types";
import Panel from "./Panel";
import { IconArrowRight } from "./icons";

interface LinkLauncherWidgetProps {
  title: string;
  instances: LinkInstance[];
  emptyLabel?: string;
}

export default function LinkLauncherWidget({
  title,
  instances,
  emptyLabel = "No instances configured.",
}: LinkLauncherWidgetProps) {
  return (
    <Panel title={title}>
      {instances.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        instances.map((i) => (
          <button key={i.url} className="launch" onClick={() => window.api.openUrl(i.url)}>
            <span>{i.label}</span>
            <span className="arrow">
              {i.url.replace(/^https?:\/\//, "")}
              <IconArrowRight />
            </span>
          </button>
        ))
      )}
    </Panel>
  );
}
