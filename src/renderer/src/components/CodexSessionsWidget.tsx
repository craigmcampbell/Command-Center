import { useState } from "react";
import type { ReactNode } from "react";
import type { CodexSession, CodexSessionsResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconArrowRight } from "./icons";

interface CodexSessionsWidgetProps {
  data: CodexSessionsResult | null;
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function relativeTime(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function SessionRow({ session }: { session: CodexSession }) {
  const [state, setState] = useState<"idle" | "opening" | "failed">("idle");
  async function resume() {
    setState("opening");
    const result = await window.api.codex.resume(session.id, session.cwd);
    setState(result.ok ? "idle" : "failed");
  }
  const details = [
    relativeTime(session.updatedAt),
    session.model,
    session.reasoningEffort,
    session.tokensUsed > 0 ? `${compact(session.tokensUsed)} tok` : undefined,
  ].filter(Boolean);

  return (
    <div className="row claude-session-row">
      <div className="claude-session-main">
        <span className="name" title={session.title}>{session.title}</span>
        <span className="claude-session-meta">{details.join(" · ")}</span>
      </div>
      <button
        className="claude-resume"
        onClick={resume}
        disabled={state === "opening" || !session.cwd}
        title={session.cwd ? `codex resume ${session.id}` : "No working directory recorded"}
      >
        {state === "opening" ? "Opening…" : state === "failed" ? "Failed" : "Resume"}
        {state === "idle" && <IconArrowRight />}
      </button>
    </div>
  );
}

function groupByProject(sessions: CodexSession[]): [string, CodexSession[]][] {
  const groups = new Map<string, CodexSession[]>();
  for (const session of sessions) {
    const list = groups.get(session.projectLabel);
    if (list) list.push(session);
    else groups.set(session.projectLabel, [session]);
  }
  return [...groups.entries()].sort((a, b) => b[1][0].updatedAt - a[1][0].updatedAt);
}

export default function CodexSessionsWidget({ data }: CodexSessionsWidgetProps) {
  let body: ReactNode;
  if (!data) body = <p className="muted">Reading Codex sessions…</p>;
  else if (!data.ok) body = <p className="muted">{data.reason}</p>;
  else if (data.sessions.length === 0) body = <p className="muted">No resumable sessions recorded yet.</p>;
  else {
    body = groupByProject(data.sessions).map(([project, sessions]) => (
      <div className="claude-session-group" key={project}>
        <h3 className="claude-session-group-title">{project}</h3>
        {sessions.map((session) => <SessionRow key={session.id} session={session} />)}
      </div>
    ));
  }
  return <Panel title="Recent Codex sessions">{body}</Panel>;
}

