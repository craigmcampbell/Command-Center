import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSubreddit } from "../../shared/subreddit";

// Production reaches Reddit through Electron's own network stack (a real
// Chromium TLS fingerprint + cookie jar), so the seam to fake here is
// `electron` itself rather than global fetch. Same vi.mock("electron") recipe
// as requests.test.ts.
const state = vi.hoisted(() => ({
  cookies: [] as { name: string }[],
  fetch: vi.fn(),
  windowsOpened: 0,
  // What a warm-up does: by default it establishes the session cookie.
  onWarm: (): void => {},
}));

vi.mock("electron", () => ({
  session: {
    fromPartition: () => ({
      setUserAgent: () => {},
      fetch: (...args: unknown[]) => state.fetch(...args),
      cookies: { get: async () => state.cookies },
    }),
  },
  BrowserWindow: class {
    constructor() {
      state.windowsOpened += 1;
    }
    async loadURL() {
      state.onWarm();
    }
    isDestroyed() {
      return false;
    }
    destroy() {}
  },
}));

const { listRedditPosts, resetRedditCache } = await import("./reddit");

const SUBS = [
  { id: 1, subreddit: "rust", sortOrder: 0 },
  { id: 2, subreddit: "programming", sortOrder: 1 },
];

function listing(subreddit: string) {
  return {
    data: {
      children: [
        {
          data: {
            id: `${subreddit}-1`,
            title: `A post in ${subreddit}`,
            author: "someone",
            subreddit,
            permalink: `/r/${subreddit}/comments/abc/a_post/`,
            url: "https://example.com/article",
            domain: "example.com",
            score: 1234,
            num_comments: 7,
            created_utc: 1_757_000_000,
            thumbnail: "https://b.thumbs.redditmedia.com/x.jpg",
            link_flair_text: "News",
            is_self: false,
            over_18: false,
          },
        },
      ],
    },
  };
}

const ok = (sub: string) => new Response(JSON.stringify(listing(sub)));
const subOf = (url: string) => url.match(/\/r\/([^/]+)\//)![1];

describe("normalizeSubreddit", () => {
  it("accepts the ways a name actually gets typed", () => {
    expect(normalizeSubreddit("rust")).toBe("rust");
    expect(normalizeSubreddit("r/rust")).toBe("rust");
    expect(normalizeSubreddit("/r/rust")).toBe("rust");
    expect(normalizeSubreddit("  R/Rust/  ")).toBe("Rust");
    expect(normalizeSubreddit("https://www.reddit.com/r/rust/")).toBe("rust");
  });

  it("rejects anything that could escape a /r/<name>/ path, and out-of-range lengths", () => {
    expect(normalizeSubreddit("../../admin")).toBeNull();
    expect(normalizeSubreddit("rust/new?limit=1")).toBeNull();
    expect(normalizeSubreddit("a")).toBeNull();
    expect(normalizeSubreddit("_leading")).toBeNull();
    expect(normalizeSubreddit("x".repeat(22))).toBeNull();
    expect(normalizeSubreddit("")).toBeNull();
  });
});

describe("listRedditPosts", () => {
  beforeEach(() => {
    resetRedditCache();
    state.cookies = [];
    state.windowsOpened = 0;
    state.fetch.mockReset();
    // A warm-up normally succeeds in establishing the session.
    state.onWarm = () => {
      state.cookies = [{ name: "loid" }];
    };
  });
  afterEach(() => resetRedditCache());

  it("does nothing at all with no subreddits configured", async () => {
    expect(await listRedditPosts([])).toEqual({ ok: true, subreddits: [] });
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.windowsOpened).toBe(0);
  });

  it("warms the session once up front when there's no cookie yet", async () => {
    state.fetch.mockImplementation(async (url: string) => ok(subOf(url)));
    await listRedditPosts(SUBS);
    expect(state.windowsOpened).toBe(1);
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it("skips the warm-up entirely when a session cookie already exists", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) => ok(subOf(url)));
    await listRedditPosts(SUBS);
    expect(state.windowsOpened).toBe(0);
  });

  it("concurrent subreddits share one warm-up rather than opening a window each", async () => {
    // Exactly CONCURRENCY subreddits, so all three are in flight together, and
    // a cookie already present so the only warm-up is the one their 403s
    // trigger. Without coalescing that would be three hidden windows.
    const three = ["a1", "b2", "c3"].map((s, i) => ({ id: i, subreddit: s, sortOrder: i }));
    state.cookies = [{ name: "loid" }];
    const seen = new Set<string>();
    state.fetch.mockImplementation(async (url: string) => {
      const sub = subOf(url);
      if (!seen.has(sub)) {
        seen.add(sub);
        return new Response("", { status: 403 });
      }
      return ok(sub);
    });
    const result = await listRedditPosts(three);
    expect(state.windowsOpened).toBe(1);
    expect(result.subreddits.every((f) => f.ok)).toBe(true);
  });

  it("re-warms once and retries when a request comes back 403", async () => {
    state.cookies = [{ name: "loid" }]; // looks warm, but the session has lapsed
    let call = 0;
    state.fetch.mockImplementation(async (url: string) => {
      call += 1;
      return call === 1 ? new Response("", { status: 403 }) : ok(subOf(url));
    });
    const result = await listRedditPosts([SUBS[0]]);
    expect(state.windowsOpened).toBe(1);
    expect(call).toBe(2);
    expect(result.subreddits[0].ok).toBe(true);
  });

  it("gives up after a second 403 rather than looping", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockResolvedValue(new Response("", { status: 403 }));
    const result = await listRedditPosts([SUBS[0]]);
    expect(state.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: false,
      reason: "Private, quarantined, or blocked",
      subreddits: [],
    });
  });

  it("maps the wire shape and builds an absolute permalink", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) => ok(subOf(url)));
    const result = await listRedditPosts([SUBS[0]]);
    expect(result.subreddits[0].posts[0]).toMatchObject({
      id: "rust-1",
      subreddit: "rust",
      permalink: "https://www.reddit.com/r/rust/comments/abc/a_post/",
      url: "https://example.com/article",
      score: 1234,
      numComments: 7,
      flair: "News",
      thumbnailUrl: "https://b.thumbs.redditmedia.com/x.jpg",
    });
  });

  it("drops thumbnail sentinels that aren't URLs", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) => {
      const body = listing(subOf(url));
      body.data.children[0].data.thumbnail = "self";
      return new Response(JSON.stringify(body));
    });
    const result = await listRedditPosts([SUBS[0]]);
    expect(result.subreddits[0].posts[0].thumbnailUrl).toBeUndefined();
  });

  it("points a self post's url at its own permalink", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) => {
      const body = listing(subOf(url));
      body.data.children[0].data.is_self = true;
      return new Response(JSON.stringify(body));
    });
    const post = (await listRedditPosts([SUBS[0]])).subreddits[0].posts[0];
    expect(post.url).toBe(post.permalink);
  });

  it("isolates a failing subreddit from the working ones", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) =>
      subOf(url) === "rust" ? ok("rust") : new Response("", { status: 404 })
    );
    const result = await listRedditPosts(SUBS);
    expect(result.ok).toBe(true);
    expect(result.subreddits[0]).toMatchObject({ subreddit: "rust", ok: true });
    expect(result.subreddits[1]).toMatchObject({
      subreddit: "programming",
      ok: false,
      reason: "Subreddit not found",
      posts: [],
    });
  });

  it("preserves configured order even though fetches finish out of order", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) => ok(subOf(url)));
    const result = await listRedditPosts(SUBS);
    expect(result.subreddits.map((f) => f.subreddit)).toEqual(["rust", "programming"]);
  });

  it("serves a repeat call from cache, and refetches when forced", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) => ok(subOf(url)));
    await listRedditPosts(SUBS);
    expect(state.fetch).toHaveBeenCalledTimes(2);
    await listRedditPosts(SUBS);
    expect(state.fetch).toHaveBeenCalledTimes(2);
    await listRedditPosts(SUBS, true);
    expect(state.fetch).toHaveBeenCalledTimes(4);
  });

  it("survives a warm-up that never establishes a session", async () => {
    state.onWarm = () => {}; // cookie never appears
    state.fetch.mockResolvedValue(new Response("", { status: 403 }));
    // Drive the warm-up's 20s cookie-poll deadline rather than waiting it out.
    vi.useFakeTimers();
    try {
      const pending = listRedditPosts([SUBS[0]]);
      await vi.advanceTimersByTimeAsync(45_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.subreddits).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
