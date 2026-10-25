import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAssistantModel, evaluateModel, resetModelListCache, suggestCompactAt } from "./assistantModels";
import { resetFetchBackoff } from "./http";

const LIST = [
  { id: "anthropic/claude-x", context_length: 200_000, supported_parameters: ["tools", "max_tokens"] },
  { id: "small/plain", context_length: 8192, supported_parameters: ["max_tokens"] },
  { id: "tiny/ctx", context_length: 4000, supported_parameters: ["tools"] },
];

describe("evaluateModel", () => {
  it("reports tool support and a compaction suggestion from the context window", () => {
    expect(evaluateModel(LIST, " anthropic/claude-x ")).toEqual({
      ok: true,
      slug: "anthropic/claude-x",
      known: true,
      tools: true,
      contextLength: 200_000,
      suggestedCompactAt: 80_000,
    });
  });

  it("flags a model that doesn't list tool calling", () => {
    expect(evaluateModel(LIST, "small/plain")).toMatchObject({ known: true, tools: false });
  });

  it("flags an unknown slug, and matches a variant to its base model", () => {
    expect(evaluateModel(LIST, "anthropic/claude-y")).toEqual({ ok: true, slug: "anthropic/claude-y", known: false });
    expect(evaluateModel(LIST, "anthropic/claude-x:nitro")).toMatchObject({ known: true, tools: true });
  });
});

describe("suggestCompactAt", () => {
  it("keeps well under the window, caps at 100k and never goes below 2000", () => {
    expect(suggestCompactAt(128_000)).toBe(51_000);
    expect(suggestCompactAt(1_000_000)).toBe(100_000);
    expect(suggestCompactAt(4000)).toBe(2000);
  });
});

describe("checkAssistantModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetModelListCache();
    resetFetchBackoff();
  });

  it("fetches the public list without a key, and caches it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: LIST })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkAssistantModel("tiny/ctx")).toMatchObject({ known: true, tools: true });
    expect(await checkAssistantModel("small/plain")).toMatchObject({ tools: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/models");
    expect(init.headers).toBeUndefined();
  });

  it("fails soft when OpenRouter can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await checkAssistantModel("x/y")).toMatchObject({ ok: false, reason: expect.stringMatching(/Couldn't reach/) });
    expect(await checkAssistantModel("  ")).toMatchObject({ ok: false, reason: "No model given" });
  });
});
