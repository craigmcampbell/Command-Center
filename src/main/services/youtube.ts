import { fetchWithTimeout } from "./http";
// Recent uploads per configured channel, read from YouTube's public per-channel
// Atom feed (https://www.youtube.com/feeds/videos.xml?channel_id=UC…). No API
// key, no OAuth, no quota — same "use the free local/public surface rather than
// register an app" call as services/spotify.ts's AppleScript.
//
// What the feed does NOT give, and why that's accepted rather than worked
// around: only the ~15 most recent uploads per channel, no duration, no view
// count, and Shorts indistinguishable from regular uploads. Getting any of
// those means the Data API v3, which needs a key and burns daily quota for
// metadata this widget doesn't show.
//
// Videos from every channel are merged into one list sorted by publish date,
// so the strip reads as a single timeline rather than a per-channel grouping.

import { parseChannelInput } from "../../shared/youtubeChannel";
import type {
  YouTubeChannelConfig,
  YouTubeChannelResolution,
  YouTubeChannelFailure,
  YouTubeResult,
  YouTubeVideo,
} from "../../shared/types";

const FEED_ROOT = "https://www.youtube.com/feeds/videos.xml";

// The same feed serves channels and playlists under different parameters.
// Channel IDs are always `UC` + 22 characters; everything else stored here is
// a playlist id (PL…/UU…/LL…/…), so the prefix is enough to tell them apart
// and no extra column is needed to remember which kind a row is.
function feedUrl(sourceId: string): URL {
  const url = new URL(FEED_ROOT);
  url.searchParams.set(
    sourceId.startsWith("UC") && sourceId.length === 24 ? "channel_id" : "playlist_id",
    sourceId
  );
  return url;
}
const VIDEOS_PER_CHANNEL = 5;
const MAX_VIDEOS = 60;
const CACHE_TTL_MS = 5 * 60_000;
const CONCURRENCY = 3;

interface ChannelCacheEntry {
  videos: YouTubeVideo[];
  fetchedAt: number;
}

const cache = new Map<string, ChannelCacheEntry>();

export function resetYouTubeCache(): void {
  cache.clear();
}

// ---- feed parsing ----
//
// Deliberately a feed-specific extractor, not a general XML parser. This repo
// has no XML dependency and one machine-generated Atom feed doesn't earn one
// (same call as skipping tree-kill in services/processes.ts). The tradeoff is
// that it only understands this exact document shape: anything else — notably
// the HTML error page YouTube serves for an unknown channel id — yields no
// entries rather than a crash, which is what the caller wants anyway.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Reject non-characters rather than emitting U+FFFD for them; leaving
      // the raw entity visible is a better tell that something is off.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!match) return "";
  const inner = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(inner).trim();
}

function tagAttr(block: string, tag: string, attr: string): string {
  const match = block.match(new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : "";
}

export function parseYouTubeFeed(xml: string): YouTubeVideo[] {
  const videos: YouTubeVideo[] = [];
  // A truncated document leaves a trailing "<entry>" with no closing tag; the
  // non-greedy match simply doesn't find it, so partial feeds lose only the
  // incomplete entry.
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  for (const entry of entries) {
    const id = tagText(entry, "yt:videoId");
    const title = tagText(entry, "title");
    const publishedAt = tagText(entry, "published");
    if (!id || !title || !publishedAt) continue;
    videos.push({
      id,
      title,
      channelId: tagText(entry, "yt:channelId"),
      // <author><name> is inside the entry and is the uploading channel's real
      // title — preferred over the configured label, which is only a
      // placeholder. In a playlist feed this varies per entry, which is
      // exactly what a card should show.
      channelTitle: tagText(entry, "name"),
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnailUrl: tagAttr(entry, "media:thumbnail", "url"),
      publishedAt,
    });
  }
  return videos;
}

// ---- resolving a channel ID from a handle ----
//
// The feed only accepts a channel ID, but a @handle is the only name a user
// can actually see. Resolving happens once, when the channel is added in
// Settings, so the 1–2MB channel page is never fetched on a poll.

// The canonical link is the ONLY reliable source of the channel's own ID on
// that page. The first `"channelId":"UC…"` occurrence in the JSON blob belongs
// to whatever the page happens to reference first — verified against
// @LinusTechTips and @fireship, where it's a *different* channel entirely, so
// a feed built from it would silently show someone else's videos.
const CANONICAL_RE =
  /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/;
const OG_TITLE_RE = /<meta property="og:title" content="([^"]*)"/;

function titleFromFeed(xml: string): string {
  // The feed's own <title> is the channel name, and it's the first one in the
  // document — before any <entry> has its own.
  const head = xml.slice(0, xml.indexOf("<entry>") === -1 ? undefined : xml.indexOf("<entry>"));
  return tagText(head, "title");
}

export async function resolveYouTubeChannel(input: string): Promise<YouTubeChannelResolution> {
  const parsed = parseChannelInput(input);
  if (!parsed) {
    return { ok: false, reason: "Not a channel ID, @handle or YouTube channel URL" };
  }

  try {
    if (parsed.kind === "id" || parsed.kind === "playlist") {
      // Already an ID — confirm it exists and pick up its real name from the
      // feed, which is far smaller than the channel page. A private or deleted
      // playlist 404s here, same as an unknown channel.
      const sourceId = parsed.kind === "id" ? parsed.channelId : parsed.playlistId;
      const res = await fetchWithTimeout(feedUrl(sourceId));
      const missing = parsed.kind === "id" ? "Channel not found" : "Playlist not found or private";
      if (res.status === 404) return { ok: false, reason: missing };
      if (!res.ok) return { ok: false, reason: `YouTube returned ${res.status}` };
      const title = titleFromFeed(await res.text());
      if (!title) return { ok: false, reason: missing };
      return { ok: true, channelId: sourceId, title };
    }

    const res = await fetchWithTimeout(`https://www.youtube.com/${parsed.path}`);
    if (res.status === 404) return { ok: false, reason: "Channel not found" };
    if (!res.ok) return { ok: false, reason: `YouTube returned ${res.status}` };
    const html = await res.text();
    const match = html.match(CANONICAL_RE);
    // YouTube answers an unknown handle with a 200 soft-404 page that has no
    // canonical channel link, so a missing match is "no such channel".
    if (!match) return { ok: false, reason: "Channel not found" };
    const title = html.match(OG_TITLE_RE);
    return {
      ok: true,
      channelId: match[1],
      title: title ? decodeEntities(title[1]) : "",
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message || "Couldn't reach YouTube" };
  }
}

// ---- fetching ----

async function fetchChannel(channel: YouTubeChannelConfig): Promise<YouTubeVideo[]> {
  const res = await fetchWithTimeout(feedUrl(channel.channelId));
  if (!res.ok) {
    // YouTube answers an unknown or malformed id with 404, which is the single
    // most likely misconfiguration here — say so specifically.
    throw new Error(res.status === 404 ? "Channel not found" : `YouTube returned ${res.status}`);
  }
  const videos = parseYouTubeFeed(await res.text());
  if (videos.length === 0) throw new Error("No videos in feed");
  return videos.slice(0, VIDEOS_PER_CHANNEL);
}

export async function listYouTubeVideos(
  channels: YouTubeChannelConfig[],
  forceRefresh = false
): Promise<YouTubeResult> {
  if (channels.length === 0) return { ok: true, videos: [], failures: [] };
  if (forceRefresh) resetYouTubeCache();

  // Drop cache entries for channels no longer configured, so removing one in
  // Settings doesn't leave its videos held in memory forever.
  const configured = new Set(channels.map((c) => c.channelId));
  for (const key of cache.keys()) if (!configured.has(key)) cache.delete(key);

  const videos: YouTubeVideo[] = [];
  const failures: YouTubeChannelFailure[] = [];
  let cursor = 0;
  // Same cursor/worker-pool shape as services/git.ts — bounded parallelism
  // without pulling in a queue library.
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, channels.length) }, async () => {
      while (cursor < channels.length) {
        const channel = channels[cursor++];
        const cached = cache.get(channel.channelId);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          videos.push(...cached.videos);
          continue;
        }
        try {
          const fetched = await fetchChannel(channel);
          cache.set(channel.channelId, { videos: fetched, fetchedAt: Date.now() });
          videos.push(...fetched);
        } catch (err) {
          failures.push({
            channelId: channel.channelId,
            label: channel.label || channel.channelId,
            reason: (err as Error).message || "Couldn't reach YouTube",
          });
        }
      }
    })
  );

  // One channel failing is a per-row problem; every channel failing is one
  // global problem worth stating once (services/git.ts makes the same call).
  if (videos.length === 0 && failures.length > 0) {
    return {
      ok: false,
      reason: failures.length === 1 ? failures[0].reason : "Couldn't reach YouTube",
      videos: [],
      failures,
    };
  }

  videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { ok: true, videos: videos.slice(0, MAX_VIDEOS), failures };
}
