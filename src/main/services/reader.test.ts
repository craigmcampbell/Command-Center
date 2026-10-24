import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listReaderDocuments, resetReaderCache } from "./reader";

const CONFIG = { apiToken: "tok" };

// `day` is both saved and (by default) updated on that day of September.
function doc(id: string, location: string, day: number, updatedDay = day) {
  const at = (d: number) => `2026-09-${String(d).padStart(2, "0")}T00:00:00+00:00`;
  return {
    id,
    title: `Doc ${id}`,
    author: "A",
    url: `https://read.readwise.io/read/${id}`,
    location,
    category: "article",
    saved_at: at(day),
    updated_at: at(updatedDay),
    parent_id: null,
    tags: {},
  };
}

// One scripted list of pages per location; each request consumes the next page.
function stubReader(pages: Record<string, ReturnType<typeof doc>[][]>) {
  const requested: string[] = [];
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    const location = url.searchParams.get("location") ?? "none";
    requested.push(location);
    const queue = pages[location] ?? [];
    const results = queue.shift() ?? [];
    return new Response(
      JSON.stringify({ results, nextPageCursor: queue.length > 0 ? `c-${location}` : null })
    );
  });
  vi.stubGlobal("fetch", fetch);
  return requested;
}

describe("listReaderDocuments", () => {
  beforeEach(() => resetReaderCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetReaderCache();
  });

  it("asks for each saved location by name and never for feed or archive", async () => {
    const requested = stubReader({ new: [[doc("1", "new", 5)]], later: [[]], shortlist: [[]] });
    const res = await listReaderDocuments(CONFIG, 0);
    expect(res.ok).toBe(true);
    expect([...new Set(requested)].sort()).toEqual(["later", "new", "shortlist"]);
  });

  it("merges locations newest-first", async () => {
    stubReader({
      new: [[doc("a", "new", 5), doc("b", "new", 1)]],
      later: [[doc("c", "later", 3)]],
      shortlist: [[doc("d", "shortlist", 4)]],
    });
    const res = await listReaderDocuments(CONFIG, 0);
    expect(res.documents.map((d) => d.id)).toEqual(["a", "d", "c", "b"]);
  });

  it("keeps paging past a day or two of documents instead of stopping at the first page", async () => {
    // 'new' has two pages: recent docs, then much older ones. The other
    // locations are empty, so the older page must be fetched to fill the list.
    const recent = Array.from({ length: 10 }, (_, i) => doc(`r${i}`, "new", 20));
    const older = Array.from({ length: 10 }, (_, i) => doc(`o${i}`, "new", 2));
    stubReader({ new: [recent, older], later: [[]], shortlist: [[]] });
    const res = await listReaderDocuments(CONFIG, 0);
    expect(res.documents).toHaveLength(15);
    expect(res.documents.some((d) => d.id.startsWith("o"))).toBe(true);
  });

  it("keeps paging each location until the merged list is complete", async () => {
    // 'later' stops (still has a next page) after reaching day 10 by updated_at,
    // so anything it holds that was saved after day 10 is present, but docs from
    // 'new' saved before day 10 could be missing docs from 'later' — hold them back.
    stubReader({
      new: [[doc("n1", "new", 20), doc("n2", "new", 3)]],
      later: [[doc("l1", "later", 15), doc("l2", "later", 10)], [doc("l3", "later", 6)]],
      shortlist: [[]],
    });
    // Only one page needed (15 not reached) so every location is drained as far as it goes.
    const res = await listReaderDocuments(CONFIG, 0);
    const ids = res.documents.map((d) => d.id);
    expect(ids).toContain("l3");
    expect(ids).toContain("n2");
  });

  it("fails soft with no token", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const res = await listReaderDocuments({ apiToken: "" }, 0);
    expect(res.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
