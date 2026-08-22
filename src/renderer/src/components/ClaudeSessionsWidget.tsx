import { useState } from "react";
import type { ReactNode } from "react";
import type { ClaudeSession, ClaudeSessionsResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconArrowRight } from "./icons";

interface ClaudeSessionsWidgetProps {
  data: ClaudeSessionsResult | null;
}

function relativeTime(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function SessionRow({ session }: { session: ClaudeSession }) {
  const [state, setState] = useState<"idle" | "opening" | "failed">("idle");

  async function resume() {
    setState("opening");
    const result = await window.api.claude.resume(session.id, session.cwd);
    setState(result.ok ? "idle" : "failed");
  }

  // The custom title is the useful label; the last prompt is the fallback for
  // a session Claude Code never got around to naming.
  const label = session.title || session.lastPrompt || "(untitled session)";

  return (
    <div className="row claude-session-row">
      <div className="claude-session-main">
        <span className="name" title={label}>
          {label}
        </span>
        {/* No project here — it's now the group heading above this row. */}
        <span className="claude-session-meta">
          {relativeTime(session.updatedAt)} · {session.requests} req ·{" "}
          ${session.costUsd < 1 ? session.costUsd.toFixed(2) : session.costUsd.toFixed(0)}
        </span>
      </div>
      <button
        className="claude-resume"
        onClick={resume}
        disabled={state === "opening" || !session.cwd}
        title={session.cwd ? `claude -r ${session.id}` : "No working directory recorded"}
      >
        {state === "opening" ? "Opening…" : state === "failed" ? "Failed" : "Resume"}
        {state === "idle" && <IconArrowRight />}
      </button>
    </div>
  );
}

// Groups preserve each session's recency order within the group (the list
// arrives pre-sorted newest-first); the groups themselves are ordered by their
// own most-recent session, so "what did I touch most recently" still reads
// top to bottom — same shape as TodoistWidget's groupByProject, except that
// one sorts groups alphabetically because task projects don't have a natural
// recency, and sessions do.
function groupByProject(sessions: ClaudeSession[]): [string, ClaudeSession[]][] {
  const groups = new Map<string, ClaudeSession[]>();
  for (const session of sessions) {
    const list = groups.get(session.projectLabel);
    if (list) list.push(session);
    else groups.set(session.projectLabel, [session]);
  }
  return Array.from(groups.entries()).sort(
    (a, b) => b[1][0].updatedAt - a[1][0].updatedAt
  );
}

export default function ClaudeSessionsWidget({ data }: ClaudeSessionsWidgetProps) {
  let body: ReactNode;

  if (!data) body = <p className="muted">Reading sessions…</p>;
  else if (!data.ok) body = <p className="muted">{data.reason}</p>;
  else if (data.sessions.length === 0) body = <p className="muted">No sessions recorded yet.</p>;
  else
    body = groupByProject(data.sessions).map(([project, sessions]) => (
      <div className="claude-session-group" key={project}>
        <h3 className="claude-session-group-title">{project}</h3>
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} />
        ))}
      </div>
    ));

  return <Panel title="Recent sessions">{body}</Panel>;
}
