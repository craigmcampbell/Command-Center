import { describe, expect, it } from "vitest";
import { cachedShare, sumUsage } from "./assistantUsage";

const base = { promptTokens: 100, completionTokens: 10, costUsd: null };

describe("sumUsage", () => {
  it("adds cache counts, and starts reporting them once any step does", () => {
    const one = sumUsage(base, { promptTokens: 50, completionTokens: 5, costUsd: 0.5, cachedTokens: 40 });
    expect(one).toEqual({ promptTokens: 150, completionTokens: 15, costUsd: 0.5, cachedTokens: 40 });
    const two = sumUsage(one, { promptTokens: 50, completionTokens: 5, costUsd: null, cachedTokens: 45, cacheWriteTokens: 5 });
    expect(two).toEqual({ promptTokens: 200, completionTokens: 20, costUsd: 0.5, cachedTokens: 85, cacheWriteTokens: 5 });
  });

  it("stays without cache counts when no step reports them", () => {
    expect(sumUsage(base, base)).toEqual({ promptTokens: 200, completionTokens: 20, costUsd: null });
    expect(sumUsage(base, undefined)).toBe(base);
  });
});

describe("cachedShare", () => {
  it("is the cached share of prompt tokens", () => {
    expect(cachedShare({ ...base, cachedTokens: 25 })).toBe(0.25);
    expect(cachedShare({ ...base, cachedTokens: 0 })).toBe(0);
  });

  it("is null with nothing to say", () => {
    expect(cachedShare(base)).toBeNull();
    expect(cachedShare({ ...base, promptTokens: 0, cachedTokens: 0 })).toBeNull();
  });
});
