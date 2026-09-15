// Latest releases from repos you've starred — "what shipped in the tools I
// use". Starring is the subscription, so there's nothing to configure.

import Panel from "./Panel";
import { safeUrl } from "../lib/urls";
import type { GitHubRelease, GitHubReleasesResult } from "../../../shared/types";

function relativeTime(iso: string): string {
  const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return weeks < 5 ? `${weeks}w ago` : `${Math.round(days / 30)}mo ago`;
}

function open(url: string) {
  const safe = safeUrl(url);
  if (safe) window.api.openUrl(safe);
}

function ReleaseRow({ release }: { release: GitHubRelease }) {
  return (
    <div className="release-row">
      <div className="release-head">
        <button type="button" className="release-repo" onClick={() => open(release.repoUrl)}>
          {release.repo}
        </button>
        <span className="release-time">{relativeTime(release.publishedAt)}</span>
      </div>
      <div className="release-title-row">
        <button type="button" className="release-tag" onClick={() => open(release.url)}>
          {release.tagName}
        </button>
        {release.isPrerelease && <span className="release-pre">pre</span>}
        {release.name !== release.tagName && (
          <span className="release-name">{release.name}</span>
        )}
      </div>
      {release.description && <p className="release-body">{release.description}</p>}
    </div>
  );
}

export default function GitHubReleasesWidget({ data }: { data: GitHubReleasesResult | null }) {
  let body;
  if (!data) {
    body = <p className="muted">Loading releases…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}.</p>;
  } else if (data.releases.length === 0) {
    body = (
      <p className="muted">
        Nothing released in the last 90 days by the repos you've starred. Star a repo to follow
        its releases.
      </p>
    );
  } else {
    body = data.releases.map((r) => <ReleaseRow key={r.id} release={r} />);
  }
  return <Panel title="Releases">{body}</Panel>;
}
