import { fetchWithTimeout } from "./http";
// Latest release from each repo you've starred — "what shipped in the tools I
// use", the counterpart to github.ts's "what's happening in my own repos".
//
// Starring is the subscription: there's no list to maintain in Settings, which
// is the whole point. Uses the same token as github.ts.
//
// GraphQL rather than REST, and that's load-bearing: REST has no "releases
// across starred repos" endpoint, so it would mean one /user/starred call plus
// one /releases/latest per repo — 100+ requests per poll against a 5000/hr
// budget shared with the GitHub widget. This is a single request.

import type { GitHubRelease, GitHubReleasesResult, GitHubScalarConfig } from "../../shared/types";

const GRAPHQL_URL = "https://api.github.com/graphql";
const USER_AGENT = "command-center-app";
// Most-recently-starred first: the things you starred years ago are the least
// likely to be what you're tracking now.
const STARRED_LIMIT = 100;
// Anything older than this isn't news. Without a window the list is just
// "every starred repo's last release", which never changes and never scrolls.
const WINDOW_DAYS = 90;
const MAX_RELEASES = 30;
const BODY_CHARS = 280;
const CACHE_TTL_MS = 10 * 60_000;

const QUERY = `query($first: Int!) {
  viewer {
    starredRepositories(first: $first, orderBy: { field: STARRED_AT, direction: DESC }) {
      nodes {
        nameWithOwner
        url
        releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { name tagName url publishedAt isPrerelease isDraft description }
        }
      }
    }
  }
}`;

interface RawRelease {
  name: string | null;
  tagName: string;
  url: string;
  publishedAt: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  description: string | null;
}

interface RawRepo {
  nameWithOwner: string;
  url: string;
  releases: { nodes: RawRelease[] };
}

let cache: { releases: GitHubRelease[]; fetchedAt: number; token: string } | null = null;

export function resetGitHubReleasesCache(): void {
  cache = null;
}

function fail(reason: string): GitHubReleasesResult {
  return { ok: false, reason, releases: [] };
}

// Release notes are full markdown changelogs — often thousands of lines. The
// widget shows a teaser, so cut it here rather than shipping all of it over
// IPC and into renderer memory for every release.
function teaser(body: string | null): string | undefined {
  if (!body) return undefined;
  const flat = body.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  if (!flat) return undefined;
  return flat.length > BODY_CHARS ? `${flat.slice(0, BODY_CHARS).trimEnd()}…` : flat;
}

export async function getGitHubReleases(
  { token }: GitHubScalarConfig,
  forceRefresh = false
): Promise<GitHubReleasesResult> {
  if (!token) return fail("No GitHub token configured");
  if (forceRefresh) cache = null;
  if (cache && cache.token === token && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, releases: cache.releases };
  }

  try {
    const res = await fetchWithTimeout(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: QUERY, variables: { first: STARRED_LIMIT } }),
    });
    if (res.status === 401) return fail("GitHub rejected the token");
    if (!res.ok) return fail(`GitHub returned ${res.status}`);

    // GraphQL reports failures as a 200 with an `errors` array — a bad scope
    // or a rate limit never shows up as a non-2xx status here.
    const body = (await res.json()) as {
      data?: { viewer?: { starredRepositories?: { nodes?: RawRepo[] } } };
      errors?: { message: string }[];
    };
    if (body.errors?.length) return fail(body.errors[0].message);

    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
    const releases: GitHubRelease[] = [];
    for (const repo of body.data?.viewer?.starredRepositories?.nodes ?? []) {
      const release = repo.releases?.nodes?.[0];
      // A draft is unpublished and has no publishedAt; neither belongs here.
      if (!release || release.isDraft || !release.publishedAt) continue;
      if (Date.parse(release.publishedAt) < cutoff) continue;
      releases.push({
        id: `${repo.nameWithOwner}@${release.tagName}`,
        repo: repo.nameWithOwner,
        repoUrl: repo.url,
        name: release.name || release.tagName,
        tagName: release.tagName,
        url: release.url,
        publishedAt: release.publishedAt,
        isPrerelease: release.isPrerelease,
        description: teaser(release.description),
      });
    }
    releases.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const trimmed = releases.slice(0, MAX_RELEASES);
    cache = { releases: trimmed, fetchedAt: Date.now(), token };
    return { ok: true, releases: trimmed };
  } catch (err) {
    return fail((err as Error).message || "Couldn't reach GitHub");
  }
}
