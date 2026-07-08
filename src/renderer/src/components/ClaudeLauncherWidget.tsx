import { useEffect, useRef, useState } from "react";
import type { ClaudeProject } from "../../../shared/types";
import Panel from "./Panel";
import { IconArrowRight, IconCheck } from "./icons";

interface ClaudeLauncherWidgetProps {
  projects: ClaudeProject[];
}

type LaunchState = "idle" | "opening" | "opened" | "failed";

function LaunchChip({ project }: { project: ClaudeProject }) {
  const [state, setState] = useState<LaunchState>("idle");
  const revertTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(revertTimeout.current), []);

  async function handleClick() {
    setState("opening");
    const res = await window.api.claude.launch(project.path);
    setState(res.ok ? "opened" : "failed");
    revertTimeout.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button className={`launch-chip state-${state}`} onClick={handleClick}>
      <span>{project.label}</span>
      <span className="chip-status">
        {state === "idle" && (
          <>
            launch <IconArrowRight />
          </>
        )}
        {state === "opening" && "opening…"}
        {state === "opened" && (
          <>
            opened <IconCheck />
          </>
        )}
        {state === "failed" && "failed"}
      </span>
    </button>
  );
}

export default function ClaudeLauncherWidget({ projects }: ClaudeLauncherWidgetProps) {
  return (
    <Panel title="Claude Code">
      {projects.length === 0 ? (
        <p className="muted">No projects configured.</p>
      ) : (
        <div className="chip-row">
          {projects.map((p) => (
            <LaunchChip key={p.path} project={p} />
          ))}
        </div>
      )}
    </Panel>
  );
}
