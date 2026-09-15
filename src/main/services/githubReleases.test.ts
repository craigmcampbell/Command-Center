import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGitHubReleases, resetGitHubReleasesCache } from "./githubReleases";

const CONFIG = { token: "tok" };
const day = 86_400_000;

function repo(name: string, daysAgo: number, extra: Record<string, unknown> = {}) {
  return {
    nameWithOwner: name,
    url: `https://github.com/${name}`,
    releases: {
      nodes: [
        {
          name: `${name} release`,
          tagName: "v1.0.0",
          url: `https://github.com/${name}/releases/tag/v1.0.0`,
          publishedAt: new Date(Date.now() - daysAgo * day).toISOString(),
          isPrerelease: false,
          isDraft: false,
          description: "Fixed things.",
          ...extra,
        },
      ],
    },
  };
}

const reply = (nodes: unknown[]) =>
  new Response(JSON.stringify({ data: { viewer: { starredRepositories: { nodes } } } }));

describe("getGitHubReleases", () => {
  beforeEach(() => resetGitHubReleasesCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetGitHubReleasesCache();
  });

  it("fails soft with no token, without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await getGitHubReleases({})).toEqual({
      ok: false,
      reason: "No GitHub token configured",
      releases: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gets every starred repo's latest release in a single request", async () => {
    const fetch = vi.fn(async () => reply([repo("a/one", 1), repo("b/two", 3)]));
    vi.stubGlobal("fetch", fetch);
    const res = await getGitHubReleases(CONFIG);
    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res.releases.map((r) => r.repo)).toEqual(["a/one", "b/two"]);
    expect(res.releases[0].id).toBe("a/one@v1.0.0");
  });

  it("sorts newest first regardless of star order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply([repo("old/repo", 30), repo("new/repo", 2)])));
    const res = await getGitHubReleases(CONFIG);
    expect(res.releases.map((r) => r.repo)).toEqual(["new/repo", "old/repo"]);
  });

  it("drops anything outside the 90-day window, so the list is news not inventory", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply([repo("fresh/repo", 10), repo("stale/repo", 200)])));
    const res = await getGitHubReleases(CONFIG);
    expect(res.releases.map((r) => r.repo)).toEqual(["fresh/repo"]);
  });

  it("skips drafts and repos with no releases at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply([
          repo("draft/repo", 1, { isDraft: true }),
          { nameWithOwner: "empty/repo", url: "u", releases: { nodes: [] } },
          repo("real/repo", 1),
        ])
      )
    );
    const res = await getGitHubReleases(CONFIG);
    expect(res.releases.map((r) => r.repo)).toEqual(["real/repo"]);
  });

  it("keeps prereleases but flags them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply([repo("pre/repo", 1, { isPrerelease: true })])));
    const res = await getGitHubReleases(CONFIG);
    expect(res.releases[0].isPrerelease).toBe(true);
  });

  it("truncates a long changelog instead of shipping the whole thing", async () => {
    const body = "line\n".repeat(500);
    vi.stubGlobal("fetch", vi.fn(async () => reply([repo("big/repo", 1, { description: body })])));
    const res = await getGitHubReleases(CONFIG);
    expect(res.releases[0].description!.length).toBeLessThan(300);
    expect(res.releases[0].description!.endsWith("…")).toBe(true);
  });

  it("surfaces a GraphQL error, which arrives as a 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "Bad credentials" }] })))
    );
    expect(await getGitHubReleases(CONFIG)).toEqual({
      ok: false,
      reason: "Bad credentials",
      releases: [],
    });
  });

  it("surfaces a rejected token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const res = await getGitHubReleases(CONFIG);
    expect(res).toMatchObject({ ok: false, reason: "GitHub rejected the token" });
  });

  it("serves a repeat call from cache, and refetches when forced", async () => {
    const fetch = vi.fn(async () => reply([repo("a/one", 1)]));
    vi.stubGlobal("fetch", fetch);
    await getGitHubReleases(CONFIG);
    await getGitHubReleases(CONFIG);
    expect(fetch).toHaveBeenCalledTimes(1);
    await getGitHubReleases(CONFIG, true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refetches when the token changes rather than serving another account's data", async () => {
    const fetch = vi.fn(async () => reply([repo("a/one", 1)]));
    vi.stubGlobal("fetch", fetch);
    await getGitHubReleases(CONFIG);
    await getGitHubReleases({ token: "different" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
