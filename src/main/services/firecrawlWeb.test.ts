import { afterEach, describe, expect, it, vi } from "vitest";
import { isPrivateHost, parseWebUrl, scrapePage, searchWeb } from "./firecrawlWeb";

const key = { apiKey: "fc-test" };

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const sentBody = (fn: ReturnType<typeof stubFetch>) => JSON.parse(fn.mock.calls[0][1].body as string);

afterEach(() => vi.unstubAllGlobals());

describe("isPrivateHost / parseWebUrl", () => {
  it("rejects local and private hosts, accepts public ones", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "172.31.255.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "nas.local", "db.internal", "intranet", "[::1]", "::1", "fd00::1", "fe80::1"]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of ["example.com", "docs.firecrawl.dev", "8.8.8.8", "172.32.0.1", "172.15.0.1", "100.63.0.1"]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });

  it("allows only http(s) without credentials", () => {
    expect(parseWebUrl("https://example.com/a?b=1")).toBeInstanceOf(URL);
    expect(parseWebUrl("ftp://example.com")).toMatch(/http/);
    expect(parseWebUrl("file:///etc/passwd")).toMatch(/http/);
    expect(parseWebUrl("javascript:alert(1)")).toMatch(/http/);
    expect(parseWebUrl("https://user:pw@example.com")).toMatch(/login/);
    expect(parseWebUrl("http://localhost:3000")).toMatch(/private/);
    expect(parseWebUrl("not a url")).toMatch(/valid/);
  });
});

describe("searchWeb", () => {
  it("posts the query with a clamped limit and maps v2 results", async () => {
    const fn = stubFetch(200, {
      success: true,
      data: {
        web: [
          { url: "https://a.example/x", title: "A page", description: "About   A\n" },
          { url: "http://localhost/secret", title: "Local" },
          { url: "javascript:alert(1)", title: "Bad" },
          { title: "No url" },
          { url: "https://b.example/", description: "" },
        ],
      },
    });
    const res = await searchWeb(key, "  site:a.example   cats ", 99);
    expect(fn.mock.calls[0][0]).toBe("https://api.firecrawl.dev/v2/search");
    expect((fn.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer fc-test");
    expect(sentBody(fn)).toEqual({ query: "site:a.example cats", limit: 10 });
    expect(res).toEqual({
      ok: true,
      results: [
        { title: "A page", url: "https://a.example/x", snippet: "About A" },
        { title: "b.example", url: "https://b.example/", snippet: "" },
      ],
    });
  });

  it("accepts the older array shape and defaults to five results", async () => {
    const fn = stubFetch(200, { success: true, data: [{ url: "https://a.example/", title: "A" }] });
    const res = await searchWeb(key, "cats");
    expect(sentBody(fn).limit).toBe(5);
    expect(res).toMatchObject({ ok: true, results: [{ url: "https://a.example/" }] });
  });

  it("fails soft with no key, an empty query, or Firecrawl errors", async () => {
    const fn = stubFetch(200, {});
    expect(await searchWeb({}, "x")).toEqual({ ok: false, reason: "No Firecrawl API key configured" });
    expect(await searchWeb(key, "   ")).toEqual({ ok: false, reason: "query is required" });
    expect(fn).not.toHaveBeenCalled();

    stubFetch(401, { error: "bad key" });
    expect(await searchWeb(key, "x")).toEqual({ ok: false, reason: "Firecrawl API key rejected" });
    stubFetch(402, { error: "payment" });
    expect(await searchWeb(key, "x")).toEqual({ ok: false, reason: "Out of Firecrawl credits" });
    stubFetch(429, {});
    expect(await searchWeb(key, "x")).toMatchObject({ ok: false, reason: expect.stringContaining("rate limit") });
    stubFetch(500, { success: false, error: "boom" });
    expect(await searchWeb(key, "x")).toEqual({ ok: false, reason: "Firecrawl request failed: boom" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await searchWeb(key, "x")).toEqual({ ok: false, reason: "Couldn't reach Firecrawl" });
  });
});

describe("scrapePage", () => {
  it("asks for main-content markdown and returns it", async () => {
    const fn = stubFetch(200, {
      success: true,
      data: { markdown: "# Title\n\nBody text.", metadata: { title: " My  page ", statusCode: 200 } },
    });
    const res = await scrapePage(key, "https://example.com/post");
    expect(fn.mock.calls[0][0]).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(sentBody(fn)).toEqual({ url: "https://example.com/post", formats: ["markdown"], onlyMainContent: true });
    expect(res).toEqual({
      ok: true,
      url: "https://example.com/post",
      title: "My page",
      content: "# Title\n\nBody text.",
      truncated: false,
    });
  });

  it("truncates long pages and says so", async () => {
    stubFetch(200, { success: true, data: { markdown: "z".repeat(30_000), metadata: {} } });
    const res = await scrapePage(key, "https://example.com/");
    expect(res).toMatchObject({ ok: true, truncated: true });
    expect((res as { content: string }).content).toHaveLength(12_000);
  });

  it("refuses private URLs without calling Firecrawl, and reports empty or error pages", async () => {
    const fn = stubFetch(200, {});
    expect(await scrapePage(key, "http://192.168.1.1/admin")).toMatchObject({ ok: false });
    expect(await scrapePage(key, "file:///etc/passwd")).toMatchObject({ ok: false });
    expect(fn).not.toHaveBeenCalled();

    stubFetch(200, { success: true, data: { markdown: "  ", metadata: {} } });
    expect(await scrapePage(key, "https://example.com/")).toEqual({ ok: false, reason: "The page had no readable text" });
    stubFetch(200, { success: true, data: { markdown: "Not found", metadata: { statusCode: 404 } } });
    expect(await scrapePage(key, "https://example.com/")).toEqual({ ok: false, reason: "The page returned HTTP 404" });
  });
});
