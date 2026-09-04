import type { MouseEvent, ReactNode } from "react";
import type { GitRepoStatus, GitStatusResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconBranch } from "./icons";
import { CursorIcon } from "./CursorIcon";

// Repos with no owner configured (a local-only scratch repo with no GitHub
// counterpart) fall into one group rather than being dropped or each
// becoming their own singleton group.
const LOCAL_GROUP = "Local";

function groupReposByOwner(repos: GitRepoStatus[]): [string, GitRepoStatus[]][] {
  const groups = new Map<string, GitRepoStatus[]>();
  for (const repo of repos) {
    const key = repo.owner || LOCAL_GROUP;
    const group = groups.get(key) ?? [];
    group.push(repo);
    groups.set(key, group);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a === LOCAL_GROUP ? 1 : b === LOCAL_GROUP ? -1 : a.localeCompare(b)))
    .map(([owner, group]) => [owner, group.slice().sort((a, b) => a.label.localeCompare(b.label))]);
}

interface GitStatusWidgetProps {
  data: GitStatusResult | null;
}

function isDirty(r: GitRepoStatus): boolean {
  return r.staged + r.unstaged + r.untracked + r.conflicted > 0;
}

// Only the non-zero counts get rendered, so a clean repo stays a quiet single
// line instead of a row of zeros competing for attention.
function CountBadges({ repo }: { repo: GitRepoStatus }) {
  const counts: { key: string; value: number; title: string }[] = [
    { key: "staged", value: repo.staged, title: "Staged" },
    { key: "unstaged", value: repo.unstaged, title: "Unstaged" },
    { key: "untracked", value: repo.untracked, title: "Untracked" },
    { key: "conflicted", value: repo.conflicted, title: "Conflicted" },
  ];
  return (
    <>
      {counts
        .filter((c) => c.value > 0)
        .map((c) => (
          <span key={c.key} className={`git-count git-${c.key}`} title={`${c.title}: ${c.value}`}>
            {c.value}
          </span>
        ))}
    </>
  );
}

function GitRow({ repo }: { repo: GitRepoStatus }) {
  // Reuses the File Links widget's ForkLift launch — no new IPC needed.
  const open = () => void window.api.forklift.open(repo.path);
  // A separate icon-button rather than a modifier-click on the row: the row
  // click is already claimed by ForkLift, and a second launcher needs to
  // stay discoverable without a keyboard modifier to remember.
  const openInCursor = (e: MouseEvent) => {
    e.stopPropagation();
    void window.api.cursor.open(repo.path);
  };

  if (!repo.ok) {
    return (
      <div className="row git-row" onClick={open} title={repo.path}>
        <span className="dot alert"></span>
        <span className="name">{repo.label}</span>
        <span className="git-cursor-btn" onClick={openInCursor} title="Open in Cursor">
          <CursorIcon />
        </span>
        <span className="status muted">{repo.reason}</span>
      </div>
    );
  }

  const dirty = isDirty(repo);

  return (
    <div className="row git-row" onClick={open} title={repo.path}>
      <span className={`dot ${dirty ? "warn" : "running"}`}></span>
      <span className="name">{repo.label}</span>
      <span className="git-cursor-btn" onClick={openInCursor} title="Open in Cursor">
        <CursorIcon />
      </span>

      <span className="git-branch" title={repo.upstream ? `Tracking ${repo.upstream}` : "No upstream"}>
        <IconBranch />
        {repo.branch}
      </span>

      {/* Absent entirely when there's no upstream — "↑0 ↓0" would imply a
          comparison that isn't actually being made. */}
      {repo.upstream && (repo.ahead > 0 || repo.behind > 0) && (
        <span className="git-ab">
          {repo.ahead > 0 && <span title={`${repo.ahead} ahead`}>↑{repo.ahead}</span>}
          {repo.behind > 0 && <span title={`${repo.behind} behind`}>↓{repo.behind}</span>}
        </span>
      )}

      <CountBadges repo={repo} />

      <span className="status git-last">
        {repo.lastCommit ? `${repo.lastCommit.subject} · ${repo.lastCommit.relative}` : "No commits yet"}
      </span>
    </div>
  );
}

export default function GitStatusWidget({ data }: GitStatusWidgetProps) {
  let pipClassName = "pip";
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Checking repositories…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}. Install the Xcode command line tools to see repo status.</p>;
    pipClassName = "pip alert";
  } else if (data.repos.length === 0) {
    body = (
      <p className="muted">
        No local repos configured. Add a local path to a repo under Settings → Repositories.
      </p>
    );
  } else {
    const anyFailed = data.repos.some((r) => !r.ok);
    const anyNeedsAttention = data.repos.some((r) => r.ok && (isDirty(r) || r.behind > 0));
    pipClassName = anyFailed ? "pip alert" : anyNeedsAttention ? "pip live" : "pip";
    body = groupReposByOwner(data.repos).map(([owner, repos]) => (
      <div className="todoist-group" key={owner}>
        <h3 className="todoist-group-title">{owner}</h3>
        {repos.map((r) => (
          <GitRow key={r.id} repo={r} />
        ))}
      </div>
    ));
  }

  return (
    <Panel title="Git" headerRight={<span className={pipClassName}></span>}>
      {body}
    </Panel>
  );
}
