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

// Reddit's wire shape, kept local so it never leaks into shared/types.ts.
interface RawPost {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  permalink: string;
  url: string;
  domain: string;
  score: number;
  num_comments: number;
  created_utc: number;
  thumbnail: string;
  link_flair_text: string | null;
  is_self: boolean;
  over_18: boolean;
}

// `thumbnail` carries sentinels ("self", "default", "nsfw", "spoiler", "")
// rather than a URL for posts without a preview image.
function thumbnailOf(raw: string | undefined): string | undefined {
  return raw && /^https?:\/\//i.test(raw) ? raw : undefined;
}

function toRedditPost(raw: RawPost): RedditPost {
  const permalink = `${ROOT}${raw.permalink}`;
  return {
    id: raw.id,
    title: raw.title,
    author: raw.author,
    subreddit: raw.subreddit,
    permalink,
    // A self post's `url` is its own permalink already, but normalize it so the
    // widget never has to branch on isSelf to decide where a click goes.
    url: raw.is_self ? permalink : raw.url,
    domain: raw.domain ?? "",
    score: raw.score ?? 0,
    numComments: raw.num_comments ?? 0,
    createdUtc: raw.created_utc ?? 0,
    thumbnailUrl: thumbnailOf(raw.thumbnail),
    flair: raw.link_flair_text || undefined,
    isSelf: Boolean(raw.is_self),
    over18: Boolean(raw.over_18),
  };
}

function listingUrl(subreddit: string): string {
  const url = new URL(`${ROOT}/r/${subreddit}/new.json`);
  url.searchParams.set("limit", String(POSTS_PER_SUBREDDIT));
  url.searchParams.set("raw_json", "1"); // stops Reddit HTML-escaping titles
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
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
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
  const body = (await res.json()) as { data?: { children?: { data: RawPost }[] } };
  return (body.data?.children ?? []).map((child) => toRedditPost(child.data));
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
