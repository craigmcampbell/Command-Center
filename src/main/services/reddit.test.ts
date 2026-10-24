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

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// What Reddit's Atom feed really looks like: the post body is HTML escaped into
// <content>, and a "[link]" anchor says where the post points.
function atom(
  subreddit: string,
  opts: { target?: string; thumbnail?: string; title?: string } = {}
): string {
  const permalink = `https://www.reddit.com/r/${subreddit}/comments/abc/a_post/`;
  const target = opts.target ?? "https://example.com/article?a=1&b=2";
  const html = `<div class="md"><p>body</p></div> <span><a href="${target.replace(/&/g, "&amp;")}">[link]</a></span> <span><a href="${permalink}">[comments]</a></span>`;
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>newest submissions : ${subreddit}</title><entry><author><name>/u/someone</name><uri>https://www.reddit.com/user/someone</uri></author><category term="${subreddit}" label="r/${subreddit}"/><content type="html">${esc(html)}</content><id>t3_${subreddit}1</id><link href="${permalink}" />${opts.thumbnail ? `<media:thumbnail url="${opts.thumbnail}" />` : ""}<updated>2026-10-23T23:44:40+00:00</updated><published>2026-10-23T23:44:40+00:00</published><title>${esc(opts.title ?? `A post in ${subreddit}`)}</title></entry></feed>`;
}

const ok = (sub: string) => new Response(atom(sub));
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

  it("maps an Atom entry to a post", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) => ok(subOf(url)));
    const post = (await listRedditPosts([SUBS[0]])).subreddits[0].posts[0];
    expect(post).toMatchObject({
      id: "rust1",
      title: "A post in rust",
      author: "someone",
      subreddit: "rust",
      permalink: "https://www.reddit.com/r/rust/comments/abc/a_post/",
      // The anchor's own &amp; is decoded back to a usable URL.
      url: "https://example.com/article?a=1&b=2",
      domain: "example.com",
      isSelf: false,
      createdUtc: Date.parse("2026-10-23T23:44:40+00:00") / 1000,
    });
    // The feed has no counts; they must be absent, not a made-up 0.
    expect(post.score).toBeUndefined();
    expect(post.numComments).toBeUndefined();
  });

  it("requests the Atom feed, not the blocked JSON listing", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) => ok(subOf(url)));
    await listRedditPosts([SUBS[0]]);
    expect(state.fetch.mock.calls[0][0]).toContain("/r/rust/new.rss");
  });

  it("decodes entities in titles", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async () => new Response(atom("rust", { title: "Rust & \"C++\" <3" })));
    const post = (await listRedditPosts([SUBS[0]])).subreddits[0].posts[0];
    expect(post.title).toBe('Rust & "C++" <3');
  });

  it("only accepts http(s) thumbnails", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async () => new Response(atom("rust", { thumbnail: "javascript:alert(1)" })));
    expect((await listRedditPosts([SUBS[0]])).subreddits[0].posts[0].thumbnailUrl).toBeUndefined();
    resetRedditCache();
    state.fetch.mockImplementation(async () => new Response(atom("rust", { thumbnail: "https://b.thumbs.redditmedia.com/x.jpg" })));
    expect((await listRedditPosts([SUBS[0]])).subreddits[0].posts[0].thumbnailUrl).toBe(
      "https://b.thumbs.redditmedia.com/x.jpg"
    );
  });

  it("points a self post's url at its own permalink", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockImplementation(async (url: string) =>
      new Response(atom(subOf(url), { target: `https://www.reddit.com/r/${subOf(url)}/comments/abc/a_post/` }))
    );
    const post = (await listRedditPosts([SUBS[0]])).subreddits[0].posts[0];
    expect(post.isSelf).toBe(true);
    expect(post.url).toBe(post.permalink);
    expect(post.domain).toBe("");
  });

  it("treats a 200 that isn't a feed as a failure, not an empty subreddit", async () => {
    state.cookies = [{ name: "loid" }];
    state.fetch.mockResolvedValue(new Response("<body>blocked</body>"));
    const result = await listRedditPosts([SUBS[0]]);
    expect(result).toEqual({ ok: false, reason: "Reddit returned an unexpected response", subreddits: [] });
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
