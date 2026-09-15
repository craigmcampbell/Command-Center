import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listYouTubeVideos, parseYouTubeFeed, resetYouTubeCache, resolveYouTubeChannel } from "./youtube";
import { parseChannelInput } from "../../shared/youtubeChannel";

// Trimmed from a real response, keeping the shapes that matter: an entity in a
// title, a numeric character reference, and the namespaced tags the parser
// reaches for.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Linus Tech Tips</title>
 <entry>
  <id>yt:video:aaaaaaaaaaa</id>
  <yt:videoId>aaaaaaaaaaa</yt:videoId>
  <yt:channelId>UCXuqSBlHAE6Xw-yeJA0Tunw</yt:channelId>
  <title>Rust &amp; C++ don&#39;t mix</title>
  <author><name>Linus Tech Tips</name></author>
  <published>2026-09-13T17:00:21+00:00</published>
  <media:group>
   <media:thumbnail url="https://i2.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" width="480" height="360"/>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:bbbbbbbbbbb</id>
  <yt:videoId>bbbbbbbbbbb</yt:videoId>
  <yt:channelId>UCXuqSBlHAE6Xw-yeJA0Tunw</yt:channelId>
  <title>An older video</title>
  <author><name>Linus Tech Tips</name></author>
  <published>2026-09-10T09:00:00+00:00</published>
  <media:group>
   <media:thumbnail url="https://i2.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg" width="480" height="360"/>
  </media:group>
 </entry>
</feed>`;

function feedFor(channelId: string, entries: { id: string; published: string }[]): string {
  const body = entries
    .map(
      (e) => `<entry><yt:videoId>${e.id}</yt:videoId><yt:channelId>${channelId}</yt:channelId>
  <title>${e.id} title</title><author><name>${channelId} name</name></author>
  <published>${e.published}</published>
  <media:group><media:thumbnail url="https://i.ytimg.com/vi/${e.id}/hqdefault.jpg"/></media:group></entry>`
    )
    .join("");
  return `<?xml version="1.0"?><feed>${body}</feed>`;
}

describe("parseYouTubeFeed", () => {
  it("extracts every field and decodes entities", () => {
    const videos = parseYouTubeFeed(FEED);
    expect(videos).toHaveLength(2);
    expect(videos[0]).toEqual({
      id: "aaaaaaaaaaa",
      title: "Rust & C++ don't mix",
      channelId: "UCXuqSBlHAE6Xw-yeJA0Tunw",
      channelTitle: "Linus Tech Tips",
      url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      thumbnailUrl: "https://i2.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
      publishedAt: "2026-09-13T17:00:21+00:00",
    });
  });

  it("returns nothing for the HTML page YouTube serves for an unknown channel", () => {
    expect(parseYouTubeFeed("<!DOCTYPE html><html><body>Not Found</body></html>")).toEqual([]);
    expect(parseYouTubeFeed("")).toEqual([]);
  });

  it("drops only the incomplete entry when the document is truncated mid-write", () => {
    const cut = FEED.slice(0, FEED.indexOf("<entry>", FEED.indexOf("<entry>") + 1) + 120);
    const videos = parseYouTubeFeed(cut);
    expect(videos.map((v) => v.id)).toEqual(["aaaaaaaaaaa"]);
  });

  it("skips an entry missing the fields the widget needs, rather than emitting a blank card", () => {
    const videos = parseYouTubeFeed(
      `<feed><entry><yt:videoId>x</yt:videoId><title>No date</title></entry></feed>`
    );
    expect(videos).toEqual([]);
  });
});

describe("listYouTubeVideos", () => {
  // Real-shaped ids: a channel id is UC + 22 characters, and that exact shape
  // is what selects the channel_id feed parameter over playlist_id.
  const CH1 = `UC${"a".repeat(22)}`;
  const CH2 = `UC${"b".repeat(22)}`;
  const channels = [
    { id: 1, label: "One", channelId: CH1, sortOrder: 0 },
    { id: 2, label: "Two", channelId: CH2, sortOrder: 1 },
  ];

  beforeEach(() => resetYouTubeCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetYouTubeCache();
  });

  it("merges channels into one date-ordered list rather than grouping by channel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const channel = new URL(input).searchParams.get("channel_id")!;
        return channel === CH1
          ? new Response(
              feedFor(CH1, [
                { id: "one-new", published: "2026-09-13T12:00:00+00:00" },
                { id: "one-old", published: "2026-09-01T12:00:00+00:00" },
              ])
            )
          : new Response(
              feedFor(CH2, [{ id: "two-mid", published: "2026-09-07T12:00:00+00:00" }])
            );
      })
    );
    const result = await listYouTubeVideos(channels);
    expect(result.ok).toBe(true);
    expect(result.videos.map((v) => v.id)).toEqual(["one-new", "two-mid", "one-old"]);
  });

  it("keeps a working channel's videos when another one fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        new URL(input).searchParams.get("channel_id") === CH1
          ? new Response(feedFor(CH1, [{ id: "one", published: "2026-09-13T12:00:00+00:00" }]))
          : new Response("", { status: 404 })
      )
    );
    const result = await listYouTubeVideos(channels);
    expect(result.ok).toBe(true);
    expect(result.videos.map((v) => v.id)).toEqual(["one"]);
    expect(result.failures).toEqual([
      { channelId: CH2, label: "Two", reason: "Channel not found" },
    ]);
  });

  it("reports one global failure when every channel fails the same way", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const result = await listYouTubeVideos(channels);
    expect(result.ok).toBe(false);
    expect(result.videos).toEqual([]);
    expect(result.failures).toHaveLength(2);
  });

  it("serves a second call from cache, and refetches when forced", async () => {
    const fetch = vi.fn(
      async (input: string | URL) =>
        new Response(
          feedFor(new URL(input).searchParams.get("channel_id")!, [
            { id: "v", published: "2026-09-13T12:00:00+00:00" },
          ])
        )
    );
    vi.stubGlobal("fetch", fetch);
    await listYouTubeVideos(channels);
    expect(fetch).toHaveBeenCalledTimes(2);
    await listYouTubeVideos(channels);
    expect(fetch).toHaveBeenCalledTimes(2);
    await listYouTubeVideos(channels, true);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("asks for a playlist by playlist_id and a channel by channel_id", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(input);
        seen.push(url.searchParams.has("channel_id") ? "channel_id" : "playlist_id");
        return new Response(feedFor("x", [{ id: "v", published: "2026-09-13T12:00:00+00:00" }]));
      })
    );
    await listYouTubeVideos([
      { id: 1, label: "chan", channelId: CH1, sortOrder: 0 },
      { id: 2, label: "list", channelId: "PLlaN88a7y2_plecYoJxvRFTLHVbIVAOoc", sortOrder: 1 },
    ]);
    expect(seen.sort()).toEqual(["channel_id", "playlist_id"]);
  });

  it("makes no request at all with nothing configured", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await listYouTubeVideos([])).toEqual({ ok: true, videos: [], failures: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("parseChannelInput", () => {
  const ID = "UCXuqSBlHAE6Xw-yeJA0Tunw";

  it("takes a bare channel ID as-is", () => {
    expect(parseChannelInput(ID)).toEqual({ kind: "id", channelId: ID });
    expect(parseChannelInput(`  ${ID}  `)).toEqual({ kind: "id", channelId: ID });
  });

  it("takes a handle with or without the @", () => {
    expect(parseChannelInput("@TinaHuang1")).toEqual({ kind: "path", path: "@TinaHuang1" });
    expect(parseChannelInput("TinaHuang1")).toEqual({ kind: "path", path: "@TinaHuang1" });
  });

  it("recognises playlists, including a share link from inside one", () => {
    const PL = "PLlaN88a7y2_plecYoJxvRFTLHVbIVAOoc";
    expect(parseChannelInput(PL)).toEqual({ kind: "playlist", playlistId: PL });
    expect(parseChannelInput(`https://www.youtube.com/playlist?list=${PL}`)).toEqual({
      kind: "playlist",
      playlistId: PL,
    });
    // "Share" from a video playing inside a playlist gives /watch?v=…&list=…
    expect(parseChannelInput(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${PL}`)).toEqual({
      kind: "playlist",
      playlistId: PL,
    });
  });

  it("takes every youtube.com URL form people actually paste", () => {
    for (const url of [
      "https://www.youtube.com/@TinaHuang1",
      "http://youtube.com/@TinaHuang1",
      "www.youtube.com/@TinaHuang1/videos",
      "https://m.youtube.com/@TinaHuang1?si=abc123",
      "youtube.com/@TinaHuang1/",
    ]) {
      expect(parseChannelInput(url), url).toEqual({ kind: "path", path: "@TinaHuang1" });
    }
    expect(parseChannelInput(`https://www.youtube.com/channel/${ID}`)).toEqual({
      kind: "id",
      channelId: ID,
    });
    expect(parseChannelInput("https://www.youtube.com/user/Computerphile")).toEqual({
      kind: "path",
      path: "user/Computerphile",
    });
    expect(parseChannelInput("https://www.youtube.com/c/veritasium")).toEqual({
      kind: "path",
      path: "c/veritasium",
    });
  });

  it("rejects junk, and anything that could escape the URL path", () => {
    expect(parseChannelInput("")).toBeNull();
    expect(parseChannelInput("   ")).toBeNull();
    // YouTube handles bottom out at 3 characters.
    expect(parseChannelInput("@abc")).toEqual({ kind: "path", path: "@abc" });
    expect(parseChannelInput("@ab")).toBeNull();
    expect(parseChannelInput("../../etc/passwd")).toBeNull();
    expect(parseChannelInput("@bad handle")).toBeNull();
    expect(parseChannelInput("https://vimeo.com/@someone")).toBeNull();
  });
});

describe("resolveYouTubeChannel", () => {
  const ID = "UCXuqSBlHAE6Xw-yeJA0Tunw";
  const OTHER = "UCdBK94H6oZT2Q7l0-b0xmMg";
  // A channel page carries many "channelId" occurrences; the first belongs to
  // some other channel the page happens to reference. Only the canonical link
  // is the page's own channel — verified live against @LinusTechTips.
  const page = `<!DOCTYPE html><html><head>
    <meta property="og:title" content="Linus Tech Tips &amp; Friends">
    <link rel="canonical" href="https://www.youtube.com/channel/${ID}">
    </head><body><script>{"channelId":"${OTHER}"}</script></body></html>`;

  afterEach(() => vi.unstubAllGlobals());

  it("resolves a handle from the canonical link, not the first channelId in the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page)));
    const res = await resolveYouTubeChannel("@LinusTechTips");
    expect(res).toEqual({ ok: true, channelId: ID, title: "Linus Tech Tips & Friends" });
    expect(res.channelId).not.toBe(OTHER);
  });

  it("requests the handle's own page", async () => {
    const fetch = vi.fn(async (_input: string | URL) => new Response(page));
    vi.stubGlobal("fetch", fetch);
    await resolveYouTubeChannel("https://www.youtube.com/@LinusTechTips/videos");
    expect(String(fetch.mock.calls[0][0])).toBe("https://www.youtube.com/@LinusTechTips");
  });

  it("confirms a bare ID against the feed and takes the channel's name from it", async () => {
    const feed = `<?xml version="1.0"?><feed><title>Linus Tech Tips</title>
      <entry><title>a video</title></entry></feed>`;
    const fetch = vi.fn(async (_input: string | URL) => new Response(feed));
    vi.stubGlobal("fetch", fetch);
    const res = await resolveYouTubeChannel(ID);
    expect(res).toEqual({ ok: true, channelId: ID, title: "Linus Tech Tips" });
    // the feed, not the 2MB channel page
    expect(String(fetch.mock.calls[0][0])).toContain("/feeds/videos.xml");
  });

  it("treats YouTube's 200 soft-404 for an unknown handle as not found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><body>Not Found</body></html>")));
    expect(await resolveYouTubeChannel("@nosuchhandle999")).toEqual({
      ok: false,
      reason: "Channel not found",
    });
  });

  it("fails soft on junk input without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const res = await resolveYouTubeChannel("../../etc/passwd");
    expect(res.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails soft when YouTube is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await resolveYouTubeChannel("@someone")).toEqual({ ok: false, reason: "network down" });
  });
});
