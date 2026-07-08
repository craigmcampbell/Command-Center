import type { SillyTavernInstance } from "../../../shared/types";
import Panel from "./Panel";

interface SillyTavernWidgetProps {
  instances: SillyTavernInstance[];
}

export default function SillyTavernWidget({ instances }: SillyTavernWidgetProps) {
  return (
    <Panel title="SillyTavern">
      {instances.length === 0 ? (
        <p className="muted">No instances configured.</p>
      ) : (
        instances.map((i) => (
          <button
            key={i.url}
            className="launch"
            onClick={() => window.api.openUrl(i.url)}
          >
            <span>{i.label}</span>
            <span className="arrow">{i.url.replace("http://", "")} →</span>
          </button>
        ))
      )}
    </Panel>
  );
}
