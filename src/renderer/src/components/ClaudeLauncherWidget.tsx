import { useEffect, useRef, useState } from "react";
import type { ClaudeProject } from "../../../shared/types";
import Panel from "./Panel";

interface ClaudeLauncherWidgetProps {
  projects: ClaudeProject[];
}

function LaunchButton({ project }: { project: ClaudeProject }) {
  const [label, setLabel] = useState("launch →");
  const revertTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(revertTimeout.current), []);

  async function handleClick() {
    setLabel("opening…");
    const res = await window.api.claude.launch(project.path);
    setLabel(res.ok ? "opened ✓" : "failed");
    revertTimeout.current = setTimeout(() => setLabel("launch →"), 2000);
  }

  return (
    <button className="launch" onClick={handleClick}>
      <span>{project.label}</span>
      <span className="arrow">{label}</span>
    </button>
  );
}

export default function ClaudeLauncherWidget({ projects }: ClaudeLauncherWidgetProps) {
  return (
    <Panel title="Claude Code">
      {projects.length === 0 ? (
        <p className="muted">No projects configured.</p>
      ) : (
        projects.map((p) => <LaunchButton key={p.path} project={p} />)
      )}
    </Panel>
  );
}
