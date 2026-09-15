import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanFeedTitle,
  listReaderFeed,
  markFeedItemsSeen,
  moveFeedItemToInbox,
  resetReaderFeedCache,
} from "./readerFeed";

const CONFIG = { apiToken: "tok" };

function doc(id: string, site: string, opened: string | null = null) {
  return {
    id,
    url: `https://read.readwise.io/read/${id}`,
    source_url: `https://${site}/post/${id}`,
    title: `Post ${id}`,
    author: "Someone",
    site_name: site,
    summary: "A summary.",
    image_url: `https://${site}/img.png`,
    published_date: "2026-09-10",
    // saved_at descending is the sort key; later ids sort first.
    saved_at: `2026-09-${id.padStart(2, "0")}T00:00:00+00:00`,
    reading_time: "4 mins",
    first_opened_at: opened,
    category: "rss",
    parent_id: null,
  };
}

describe("cleanFeedTitle", () => {
  it("strips a leading date the publisher jammed into the title", () => {
    expect(cleanFeedTitle("Aug 26, 2026Societal Impacts")).toBe("Societal Impacts");
    expect(cleanFeedTitle("2026-09-04Formalizing Fermat")).toBe("Formalizing Fermat");
  });

  it("leaves an ordinary title alone, and never returns empty", () => {
    expect(cleanFeedTitle("Scaling storage to 1B users")).toBe("Scaling storage to 1B users");
    // A title that legitimately starts with a number isn't a date prefix.
    expect(cleanFeedTitle("10 things about Rust")).toBe("10 things about Rust");
    expect(cleanFeedTitle(null)).toBe("Untitled");
    expect(cleanFeedTitle("")).toBe("Untitled");
  });
});

describe("listReaderFeed", () => {
  beforeEach(() => resetReaderFeedCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetReaderFeedCache();
  });

  it("fails soft with no token, without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const res = await listReaderFeed({ apiToken: "" }, 0);
    expect(res.ok).toBe(false);
    expect(res.items).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("filters to the feed location server-side rather than paging everything", async () => {
    const fetch = vi.fn(async (input: string | URL) => {
      expect(new URL(input).searchParams.get("location")).toBe("feed");
      return new Response(JSON.stringify({ results: [doc("1", "openai.com")], nextPageCursor: null }));
    });
    vi.stubGlobal("fetch", fetch);
    const res = await listReaderFeed(CONFIG, 0);
    expect(res.ok).toBe(true);
    expect(res.items[0]).toMatchObject({
      id: "1",
      siteName: "openai.com",
      summary: "A summary.",
      unread: true,
    });
  });

  it("treats a never-opened document as unread and an opened one as read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [doc("1", "a.com"), doc("2", "a.com", "2026-09-12T00:00:00+00:00")],
            nextPageCursor: null,
          })
        )
      )
    );
    const res = await listReaderFeed(CONFIG, 0);
    expect(res.items.map((i) => i.unread)).toEqual([false, true]); // id 2 sorts first
  });

  it("reports every source seen, alphabetically", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [doc("1", "zebra.com"), doc("2", "Apple.com"), doc("3", "zebra.com"), doc("4", "mid.com")],
            nextPageCursor: null,
          })
        )
      )
    );
    const res = await listReaderFeed(CONFIG, 0);
    // Alphabetical, not busiest-first, and case doesn't split the ordering.
    expect(res.sources).toEqual([
      { name: "Apple.com", count: 1 },
      { name: "mid.com", count: 1 },
      { name: "zebra.com", count: 2 },
    ]);
  });

  it("keeps pulling pages so a filtered source can still fill a page", async () => {
    // Only one matching item per upstream page: filtering to the quiet source
    // must keep fetching rather than returning a near-empty page.
    let cursor = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        cursor += 1;
        const results = [doc(String(cursor), "quiet.com"), ...Array.from({ length: 20 }, (_, i) => doc(`${cursor}${i}x`, "loud.com"))];
        return new Response(
          JSON.stringify({ results, nextPageCursor: cursor < 20 ? `c${cursor}` : null })
        );
      })
    );
    const res = await listReaderFeed(CONFIG, 0, "quiet.com");
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(15);
    expect(res.items.every((i) => i.siteName === "quiet.com")).toBe(true);
  });

  it("surfaces a rejected token as a reason rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const res = await listReaderFeed(CONFIG, 0);
    expect(res).toMatchObject({ ok: false, reason: "Readwise token rejected", items: [] });
  });
});

describe("feed actions", () => {
  beforeEach(() => resetReaderFeedCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetReaderFeedCache();
  });

  async function seed(docs: ReturnType<typeof doc>[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ results: docs, nextPageCursor: null })))
    );
    await listReaderFeed(CONFIG, 0);
    vi.unstubAllGlobals();
  }

  it("moves an item to the inbox and drops it locally without refetching", async () => {
    await seed([doc("1", "a.com"), doc("2", "a.com")]);
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/update/1/");
      expect(JSON.parse(String(init?.body))).toEqual({ location: "new" });
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetch);
    const res = await moveFeedItemToInbox(CONFIG, "1", 0);
    expect(res.ok).toBe(true);
    expect(res.items.map((i) => i.id)).toEqual(["2"]);
    expect(fetch).toHaveBeenCalledTimes(1); // no refetch
  });

  it("marks items seen in batches of 50 and flips them locally", async () => {
    const many = Array.from({ length: 120 }, (_, i) => doc(String(i + 1), "a.com"));
    await seed(many);
    const batches: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        expect(String(input)).toContain("/bulk_update/");
        const body = JSON.parse(String(init?.body));
        expect(body.updates[0]).toEqual({ id: body.updates[0].id, seen: true });
        batches.push(body.updates.length);
        return new Response("{}");
      })
    );
    const ids = many.map((d) => d.id);
    const res = await markFeedItemsSeen(CONFIG, ids, 0);
    expect(batches).toEqual([50, 50, 20]); // the API's per-request cap
    expect(res.items.every((i) => !i.unread)).toBe(true);
  });

  it("does nothing, and sends nothing, when there's nothing to mark", async () => {
    await seed([doc("1", "a.com")]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const res = await markFeedItemsSeen(CONFIG, [], 0);
    expect(res.ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tolerates a 207 partial success rather than failing the gesture", async () => {
    await seed([doc("1", "a.com")]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 207 })));
    const res = await markFeedItemsSeen(CONFIG, ["1"], 0);
    expect(res.ok).toBe(true);
  });
});
