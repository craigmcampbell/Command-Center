// Recent posts per configured subreddit, with no API key and no OAuth app.
//
// Reddit doesn't block anonymous reads — it blocks clients that don't look like
// a browser. Verified 2026-09-13 from this machine: plain HTTP gets 403 on
// `/r/<sub>.json` and 429 on the second `.rss` request even at 20s spacing, no
// matter what User-Agent string it sends. The block is on the TLS handshake and
// the missing session, not the UA header.
//
// Glance/Dynacat work around that with uTLS (forging a Firefox TLS
// fingerprint), then regex a JS challenge off the homepage and trade the
// "solution" for a `loid` cookie. We need none of it: this is Electron, so we
// have a real Chromium. Reddit doesn't even serve us the challenge page.
//
// So: one hidden BrowserWindow navigation to reddit.com lets Chromium run
// Reddit's own JS and collect a normal logged-out session cookie, exactly as
// opening a tab would. After that plain `session.fetch` works, and the cookies
// persist to disk in the partition — so the warm-up happens on first run and
// then only when the session lapses. No account, no credentials, no user setup.
//
// UPDATE (2026-10-23): Reddit now answers `/r/<sub>/new.json` with the same 403
// block page even INSIDE the warmed Chromium session (verified: an in-page
// `fetch()` after a normal page load gets it too), while `/r/<sub>/new.rss`
// still returns 200 Atom to that session. So this reads the Atom feed. What
// that costs: no score, no comment count, no flair and no NSFW flag — the feed
// simply doesn't carry them — so those fields are optional on RedditPost and the
// widget leaves them out rather than showing a made-up 0.
//
// The tradeoff, accepted knowingly: this is an unofficial path and Reddit can
// change it. If it ever breaks, the OAuth `client_credentials` grant (a
// "script" app's id + secret) is the stable documented alternative — it was
// built and then removed in favour of this, so see git history rather than
// reinventing it.

import { BrowserWindow, session, type Session } from "electron";
import { normalizeSubreddit } from "../../shared/subreddit";
import type { RedditPost, RedditResult, RedditSubredditFeed, SubredditConfig } from "../../shared/types";

const ROOT = "https://www.reddit.com";
// Its own partition, not the app's default session: this holds reddit.com
// cookies and nothing else, and can be cleared without touching anything else.
const PARTITION = "persist:reddit";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
// The cookie that marks a usable session. A partition that has only
// `edgebucket` got the interstitial, not the real page, and will 403.
const SESSION_COOKIE = "loid";
const POSTS_PER_SUBREDDIT = 25;
const CACHE_TTL_MS = 5 * 60_000;
const CONCURRENCY = 3;
const WARM_TIMEOUT_MS = 20_000;
const COOKIE_POLL_MS = 250;

interface FeedCacheEntry {
  posts: RedditPost[];
  fetchedAt: number;
}

let redditSession: Session | null = null;
// The in-flight warm-up, so concurrent subreddit fetches that all 403 at once
// open one hidden window between them rather than one each.
let warming: Promise<void> | null = null;
const feedCache = new Map<string, FeedCacheEntry>();

export function resetRedditCache(): void {
  feedCache.clear();
}

function getSession(): Session {
  if (!redditSession) {
    redditSession = session.fromPartition(PARTITION);
    redditSession.setUserAgent(USER_AGENT);
  }
  return redditSession;
}

async function hasSessionCookie(): Promise<boolean> {
  const cookies = await getSession().cookies.get({ domain: ".reddit.com", name: SESSION_COOKIE });
  return cookies.length > 0;
}

// Loads reddit.com in a hidden, hardened window purely so Chromium runs the
// page's own JS and stores the cookies it sets. Nothing from the page is read
// or executed by us, and the window is destroyed either way.
async function warmSession(): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: getSession(),
      // This renders a remote page, so lock it down to the extent a rendered
      // page can be: no Node, isolated context, sandboxed renderer, no preload.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });
  try {
    await win.loadURL(`${ROOT}/`);
    // loadURL resolves when the document loads, which is before the scripts
    // that set the session cookie have run — so poll for the cookie itself
    // rather than guessing at a fixed delay.
    const deadline = Date.now() + WARM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await hasSessionCookie()) return;
      await new Promise((resolve) => setTimeout(resolve, COOKIE_POLL_MS));
    }
    throw new Error("Reddit didn't establish a session");
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function ensureWarm(): Promise<void> {
  if (warming) return warming;
  warming = warmSession().finally(() => {
    warming = null;
  });
  return warming;
}

// ---- Atom feed parsing ------------------------------------------------------
//
// A feed-specific extractor, not an XML parser — same call as youtube.ts: one
// machine-generated document shape doesn't earn a dependency. Anything that
// isn't that shape (notably Reddit's HTML block page) yields no entries rather
// than throwing; fetchSubreddit turns "not a feed at all" into an error.

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]).trim() : undefined;
}

function attr(xml: string, tag: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}\\s[^>]*?${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : undefined;
}

export function parseRedditFeed(xml: string, subreddit: string): RedditPost[] {
  const posts: RedditPost[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1];
    const fullname = tagText(entry, "id");
    const title = tagText(entry, "title");
    const permalink = attr(entry, "link", "href");
    // Only comment threads: anything else in the feed isn't a post.
    if (!fullname?.startsWith("t3_") || !title || !permalink?.startsWith(ROOT + "/")) continue;

    // The body is HTML escaped into the XML. For a link post it holds a
    // "[link]" anchor pointing at the target; for a self post that anchor
    // points back at the thread itself.
    const html = tagText(entry, "content") ?? "";
    const target = html.match(/<a href="([^"]+)">\[link\]<\/a>/)?.[1];
    const url = target ? decodeEntities(target) : permalink;
    const isSelf = url === permalink;

    const published = Date.parse(tagText(entry, "published") ?? tagText(entry, "updated") ?? "");
    let domain = "";
    if (!isSelf) {
      try {
        domain = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // an unparseable target just has no domain label
      }
    }
    const thumbnail = attr(entry, "media:thumbnail", "url");

    posts.push({
      id: fullname.slice(3),
      title,
      author: (tagText(entry.match(/<author>[\s\S]*?<\/author>/)?.[0] ?? "", "name") ?? "unknown").replace(/^\/?u\//, ""),
      subreddit,
      permalink,
      url,
      domain,
      createdUtc: Number.isFinite(published) ? Math.floor(published / 1000) : 0,
      thumbnailUrl: thumbnail && /^https?:\/\//i.test(thumbnail) ? thumbnail : undefined,
      isSelf,
      over18: false,
    });
  }
  return posts;
}

function listingUrl(subreddit: string): string {
  const url = new URL(`${ROOT}/r/${subreddit}/new.rss`);
  url.searchParams.set("limit", String(POSTS_PER_SUBREDDIT));
  return url.toString();
}

async function fetchSubreddit(subreddit: string): Promise<RedditPost[]> {
  // Settings normalizes on write, but this is the last point before a stored
  // string becomes a URL path segment — a row predating that normalization
  // would otherwise walk straight into the path.
  const name = normalizeSubreddit(subreddit);
  if (!name) throw new Error("Not a valid subreddit name");

  const request = () =>
    getSession().fetch(listingUrl(name), {
      headers: { Accept: "application/atom+xml, application/xml;q=0.9", "User-Agent": USER_AGENT },
    });

  let res = await request();
  if (res.status === 403 || res.status === 429) {
    // Session lapsed or was never established. Re-warm once and retry; a
    // second block is a real failure.
    await ensureWarm();
    res = await request();
  }
  if (!res.ok) {
    if (res.status === 403) throw new Error("Private, quarantined, or blocked");
    if (res.status === 404) throw new Error("Subreddit not found");
    if (res.status === 429) throw new Error("Rate limited by Reddit");
    throw new Error(`Reddit returned ${res.status}`);
  }
  const xml = await res.text();
  // A 200 that isn't a feed is the block page wearing a success status.
  if (!xml.includes("<feed")) throw new Error("Reddit returned an unexpected response");
  return parseRedditFeed(xml, name);
}

export async function listRedditPosts(
  subreddits: SubredditConfig[],
  forceRefresh = false
): Promise<RedditResult> {
  if (subreddits.length === 0) return { ok: true, subreddits: [] };
  if (forceRefresh) feedCache.clear();

  const configured = new Set(subreddits.map((s) => s.subreddit));
  for (const key of feedCache.keys()) if (!configured.has(key)) feedCache.delete(key);

  // Warm up front when there's no session yet, rather than letting every
  // subreddit spend a 403 discovering the same thing.
  try {
    if (!(await hasSessionCookie())) await ensureWarm();
  } catch {
    // Fall through: the per-subreddit fetches report the failure themselves,
    // and a stale-but-present cookie may still work.
  }

  const feeds = new Array<RedditSubredditFeed>(subreddits.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, subreddits.length) }, async () => {
      while (cursor < subreddits.length) {
        const index = cursor++;
        const { subreddit } = subreddits[index];
        const cached = feedCache.get(subreddit);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          feeds[index] = { subreddit, ok: true, posts: cached.posts };
          continue;
        }
        try {
          const posts = await fetchSubreddit(subreddit);
          feedCache.set(subreddit, { posts, fetchedAt: Date.now() });
          feeds[index] = { subreddit, ok: true, posts };
        } catch (err) {
          feeds[index] = {
            subreddit,
            ok: false,
            reason: (err as Error).message || "Couldn't reach Reddit",
            posts: [],
          };
        }
      }
    })
  );

  // Every subreddit failing the same way is one problem, not N — a lapsed
  // session or no network hits them all identically. Say it once.
  if (feeds.length > 0 && feeds.every((f) => !f.ok && f.reason === feeds[0].reason)) {
    return { ok: false, reason: feeds[0].reason, subreddits: [] };
  }

  return { ok: true, subreddits: feeds };
}
