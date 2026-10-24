import { describe, expect, it } from "vitest";
import { parseUsage } from "./assistantClient";

describe("parseUsage", () => {
  it("reads cache reads and writes from prompt_tokens_details", () => {
    expect(
      parseUsage({
        prompt_tokens: 10_000,
        completion_tokens: 200,
        cost: 0.01,
        prompt_tokens_details: { cached_tokens: 8000, cache_write_tokens: 1500 },
      })
    ).toEqual({ promptTokens: 10_000, completionTokens: 200, costUsd: 0.01, cachedTokens: 8000, cacheWriteTokens: 1500 });
  });

  it("keeps a reported zero, which means nothing was cached", () => {
    expect(parseUsage({ prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } })).toEqual({
      promptTokens: 5,
      completionTokens: 1,
      costUsd: null,
      cachedTokens: 0,
    });
  });

  it("leaves the cache fields out when they aren't reported", () => {
    for (const details of [undefined, null, {}, { cached_tokens: null }, { cached_tokens: "12" }, { cached_tokens: -1 }]) {
      const usage = parseUsage({ prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: details });
      expect(usage).toEqual({ promptTokens: 5, completionTokens: 1, costUsd: null });
      expect(usage).not.toHaveProperty("cachedTokens");
      expect(usage).not.toHaveProperty("cacheWriteTokens");
    }
  });

  it("is undefined without token counts", () => {
    expect(parseUsage(undefined)).toBeUndefined();
    expect(parseUsage({ prompt_tokens_details: { cached_tokens: 3 } })).toBeUndefined();
  });
});
