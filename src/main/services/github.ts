// GitHub REST API: latest Actions run + open PRs per configured repo, plus a
// single cross-repo "review requested" search. Fails soft, like the other
// services. Personal access token lives in config.json's `github.token`,
// same as the Todoist/Readwise tokens.

import type {
  CiRun,
  GitHubConfig,
  GitHubPr,
  GitHubRepoConfig,
  GitHubRepoStatus,
  GitHubStatusResult,
} from "../../shared/types";

const API_ROOT = "https://api.github.com";
const USER_AGENT = "command-center-app";

function githubFetch(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      Accept: "application/vnd.github+json",
    },
  });
}

// GitHub signals a rate limit via 403/429 with `x-ratelimit-remaining: 0`,
// not a distinct status code — a plain 403 can also mean "bad token".
function rateLimitReason(res: Response): string | null {
  if (res.status !== 403 && res.status !== 429) return null;
  if (res.headers.get("x-ratelimit-remaining") !== "0") return null;

  const resetAt = Number(res.headers.get("x-ratelimit-reset"));
  const mins = resetAt ? Math.max(1, Math.ceil((resetAt * 1000 - Date.now()) / 60_000)) : null;
  return mins ? `Rate limited, retry in ${mins}m` : "Rate limited";
}

function repoLabelFromApiUrl(repositoryUrl: string | undefined): string {
  return repositoryUrl?.split("/").slice(-2).join("/") ?? "unknown";
}

// How many recent runs (any branch — main pushes and PR branches alike) to
// show in the widget's history strip. The Actions runs endpoint already
// returns newest-first with no filter needed.
const CI_HISTORY_LIMIT = 6;

export async function getRepoStatus(
  repoConfig: GitHubRepoConfig,
  token: string
): Promise<GitHubRepoStatus> {
  const { label, owner, repo, branch } = repoConfig;
  const prsUrl = `https://github.com/${owner}/${repo}/pulls`;
  const empty = {
    label,
    owner,
    repo,
    branch,
    prsUrl,
    ci: null,
    ciHistory: [],
    openPrCount: 0,
    openPrs: [],
  };

  let runsRes: Response;
  let prsRes: Response;
  try {
    [runsRes, prsRes] = await Promise.all([
      githubFetch(`${API_ROOT}/repos/${owner}/${repo}/actions/runs?per_page=${CI_HISTORY_LIMIT}`, token),
      githubFetch(
        `${API_ROOT}/repos/${owner}/${repo}/pulls?state=open&per_page=100&sort=created&direction=desc`,
        token
      ),
    ]);
  } catch {
    return { ...empty, ok: false, reason: "Couldn't reach GitHub" };
  }

  const rateLimited = rateLimitReason(runsRes) ?? rateLimitReason(prsRes);
  if (rateLimited) return { ...empty, ok: false, reason: rateLimited };

  if (!runsRes.ok || !prsRes.ok) {
    const badStatus = !runsRes.ok ? runsRes.status : prsRes.status;
    return {
      ...empty,
      ok: false,
      reason: badStatus === 401 ? "GitHub token rejected" : `GitHub request failed (${badStatus})`,
    };
  }

  const runsData = await runsRes.json();
  const prsData: any[] = await prsRes.json();

  const ciHistory: CiRun[] = (runsData.workflow_runs ?? []).map((run: any) => ({
    status: run.status,
    conclusion: run.conclusion,
    workflowName: run.name || run.display_title || "Workflow",
    url: run.html_url,
    updatedAt: run.updated_at,
    branch: run.head_branch || "unknown",
  }));
  const ci = ciHistory[0] ?? null;

  const openPrs: GitHubPr[] = prsData.slice(0, 5).map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login || "unknown",
    url: pr.html_url,
    repoLabel: label,
  }));

  return { ...empty, ok: true, ci, ciHistory, openPrCount: prsData.length, openPrs };
}

export async function getReviewRequests(
  user: string,
  token: string
): Promise<{ ok: boolean; reason?: string; prs: GitHubPr[] }> {
  if (!user) return { ok: false, reason: "No reviewUser configured", prs: [] };

  const query = `is:open is:pr review-requested:${user}`;
  let res: Response;
  try {
    res = await githubFetch(`${API_ROOT}/search/issues?q=${encodeURIComponent(query)}`, token);
  } catch {
    return { ok: false, reason: "Couldn't reach GitHub", prs: [] };
  }

  const rateLimited = rateLimitReason(res);
  if (rateLimited) return { ok: false, reason: rateLimited, prs: [] };
  if (!res.ok) {
    return {
      ok: false,
      reason: res.status === 401 ? "GitHub token rejected" : `GitHub search failed (${res.status})`,
      prs: [],
    };
  }

  const data = await res.json();
  const prs: GitHubPr[] = (data.items || []).map((item: any) => ({
    number: item.number,
    title: item.title,
    author: item.user?.login || "unknown",
    url: item.html_url,
    repoLabel: repoLabelFromApiUrl(item.repository_url),
  }));

  return { ok: true, prs };
}

export async function getGitHubStatus(config: GitHubConfig | undefined): Promise<GitHubStatusResult> {
  const token = config?.token;
  if (!token) {
    return {
      ok: false,
      reason: "No GitHub token configured",
      repos: [],
      reviewRequested: [],
      reviewRequestedReason: "No GitHub token configured",
    };
  }

  const repos = config?.repos ?? [];
  const [repoStatuses, reviewResult] = await Promise.all([
    Promise.all(repos.map((r) => getRepoStatus(r, token))),
    getReviewRequests(config?.reviewUser ?? "", token),
  ]);

  return {
    ok: true,
    repos: repoStatuses,
    reviewRequested: reviewResult.prs,
    reviewRequestedReason: reviewResult.ok ? undefined : reviewResult.reason,
  };
}

