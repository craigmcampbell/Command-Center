import type { CiRun, GitHubPr, GitHubRepoStatus, GitHubStatusResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconExternal } from "./icons";

interface GitHubWidgetProps {
  data: GitHubStatusResult | null;
}

const FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "action_required"]);

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ciStatusClass(ci: CiRun | null, base: string): string {
  if (!ci) return base;
  if (ci.status !== "completed") return `${base} pending`;
  if (ci.conclusion === "success") return `${base} live`;
  if (ci.conclusion && FAILURE_CONCLUSIONS.has(ci.conclusion)) return `${base} alert`;
  return base;
}

function ciPipClass(ci: CiRun | null): string {
  return ciStatusClass(ci, "pip");
}

function overallPipClass(data: GitHubStatusResult): string {
  if (!data.ok) return "pip alert";
  const runs = data.repos.map((r) => r.ci).filter((ci): ci is CiRun => !!ci);
  if (runs.some((ci) => ci.status === "completed" && ci.conclusion && FAILURE_CONCLUSIONS.has(ci.conclusion))) {
    return "pip alert";
  }
  if (runs.some((ci) => ci.status !== "completed")) return "pip pending";
  if (runs.length > 0) return "pip live";
  return "pip";
}

function groupReposByOwner(repos: GitHubRepoStatus[]): [string, GitHubRepoStatus[]][] {
  const groups = new Map<string, GitHubRepoStatus[]>();
  for (const repo of repos) {
    const group = groups.get(repo.owner) ?? [];
    group.push(repo);
    groups.set(repo.owner, group);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, group]) => [owner, group.slice().sort((a, b) => a.label.localeCompare(b.label))]);
}

function PrRow({ pr, showRepo }: { pr: GitHubPr; showRepo: boolean }) {
  return (
    <div className="row github-pr-row">
      <span className="name link" onClick={() => window.api.openUrl(pr.url)}>
        {pr.title}
        <IconExternal className="external-icon" />
      </span>
      <span className="tag">
        {showRepo ? `${pr.repoLabel} · ` : ""}#{pr.number} · {pr.author}
      </span>
    </div>
  );
}

function RepoRow({ repo }: { repo: GitHubRepoStatus }) {
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  // Oldest-to-newest, left-to-right, so the strip reads like a timeline
  // ending at the same "now" the leading pip and CI info line describe.
  const history = repo.ciHistory.slice().reverse();
  return (
    <div className="github-repo-group">
      <div className="row github-repo-row">
        <span className={ciPipClass(repo.ci)}></span>
        <span
          className="github-repo-label"
          onClick={() => window.api.openUrl(repoUrl)}
          title="Open repo on GitHub"
        >
          {repo.label}
          <IconExternal className="external-icon" />
        </span>
        {!repo.ok ? (
          <span className="tag github-ci-info">{repo.reason}</span>
        ) : repo.ci ? (
          <span
            className="name link github-ci-info"
            onClick={() => window.api.openUrl(repo.ci!.url)}
          >
            {repo.ci.workflowName} · {relativeTime(repo.ci.updatedAt)}
            {repo.ci.branch !== repo.branch ? ` · ${repo.ci.branch}` : ""}
            <IconExternal className="external-icon" />
          </span>
        ) : (
          <span className="tag github-ci-info">No CI runs yet</span>
        )}
        <span className="github-pr-badge" onClick={() => window.api.openUrl(repo.prsUrl)}>
          {repo.openPrCount} PR{repo.openPrCount === 1 ? "" : "s"}
        </span>
      </div>
      {history.length > 1 ? (
        <div className="github-ci-history">
          {history.map((run, i) => (
            <span
              key={`${run.url}-${i}`}
              className={ciStatusClass(run, "ci-history-pip")}
              title={`${run.branch} · ${relativeTime(run.updatedAt)}`}
              onClick={() => window.api.openUrl(run.url)}
            ></span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function GitHubWidget({ data }: GitHubWidgetProps) {
  if (!data) {
    return (
      <Panel title="GitHub">
        <p className="muted">Checking GitHub…</p>
      </Panel>
    );
  }

  if (!data.ok) {
    return (
      <Panel title="GitHub" headerRight={<span className="pip alert"></span>}>
        <p className="muted">
          {data.reason}. Set the GITHUB_TOKEN environment variable, or add a
          github-token file next to config.json.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="GitHub" headerRight={<span className={overallPipClass(data)}></span>}>
      <div className="todoist-group">
        <h3 className="todoist-group-title">Needs your review</h3>
        {data.reviewRequestedReason ? (
          <p className="muted">{data.reviewRequestedReason}.</p>
        ) : data.reviewRequested.length === 0 ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          data.reviewRequested.map((pr) => (
            <PrRow key={`${pr.repoLabel}#${pr.number}`} pr={pr} showRepo />
          ))
        )}
      </div>

      {data.repos.length === 0 ? (
        <p className="muted">No repos configured in config.json.</p>
      ) : (
        groupReposByOwner(data.repos).map(([owner, repos]) => (
          <div className="todoist-group" key={owner}>
            <h3 className="todoist-group-title">{owner}</h3>
            {repos.map((repo) => (
              <RepoRow key={`${repo.owner}/${repo.repo}`} repo={repo} />
            ))}
          </div>
        ))
      )}
    </Panel>
  );
}
