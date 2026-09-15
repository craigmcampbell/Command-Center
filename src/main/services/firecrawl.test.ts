import { afterEach, describe, expect, it, vi } from "vitest";
import { getFirecrawlUsage } from "./firecrawl";
import { resetFetchBackoff } from "./http";

const CONFIG = { apiKey: "fc-test" };

function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const SAMPLE = {
  success: true,
  data: {
    remainingCredits: 5207,
    planCredits: 5000,
    billingPeriodStart: "2026-09-14T22:58:23.000Z",
    billingPeriodEnd: "2026-10-14T22:58:23.000Z",
  },
};

const HISTORICAL = {
  success: true,
  periods: [
    {
      startDate: "2026-08-14T22:58:23.000Z",
      endDate: "2026-09-14T22:58:23.000Z",
      totalCredits: 4100,
    },
    {
      startDate: "2026-09-14T22:58:23.000Z",
      endDate: "2026-10-14T22:58:23.000Z",
      totalCredits: 293,
    },
  ],
};

const BY_KEY = {
  success: true,
  periods: [
    {
      startDate: "2026-09-14T22:58:23.000Z",
      endDate: "2026-10-14T22:58:23.000Z",
      apiKey: "prod",
      totalCredits: 200,
    },
    {
      startDate: "2026-09-14T22:58:23.000Z",
      endDate: "2026-10-14T22:58:23.000Z",
      apiKey: "dev",
      creditsUsed: 93,
    },
    {
      startDate: "2026-08-14T22:58:23.000Z",
      endDate: "2026-09-14T22:58:23.000Z",
      apiKey: "prod",
      totalCredits: 4100,
    },
  ],
};

function stubApi(handlers: (url: string) => Response) {
  const fetch = vi.fn(async (input: string | URL) => handlers(String(input)));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("getFirecrawlUsage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetFetchBackoff();
  });

  it("fails soft with no key, without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await getFirecrawlUsage({})).toEqual({
      ok: false,
      reason: "No Firecrawl API key configured",
      remainingCredits: 0,
      planCredits: 0,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      periods: [],
      byKey: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps remaining, plan, this-period spend, and month history", async () => {
    const fetch = stubApi((url) => {
      if (url.includes("byApiKey")) return jsonReply(BY_KEY);
      if (url.includes("historical")) return jsonReply(HISTORICAL);
      return jsonReply(SAMPLE);
    });
    const res = await getFirecrawlUsage(CONFIG);
    expect(res).toEqual({
      ok: true,
      remainingCredits: 5207,
      planCredits: 5000,
      billingPeriodStart: "2026-09-14T22:58:23.000Z",
      billingPeriodEnd: "2026-10-14T22:58:23.000Z",
      periods: [
        {
          startDate: "2026-08-14T22:58:23.000Z",
          endDate: "2026-09-14T22:58:23.000Z",
          creditsUsed: 4100,
        },
        {
          startDate: "2026-09-14T22:58:23.000Z",
          endDate: "2026-10-14T22:58:23.000Z",
          creditsUsed: 293,
        },
      ],
      byKey: [
        { key: "prod", label: "prod", creditsUsed: 200 },
        { key: "dev", label: "dev", creditsUsed: 93 },
      ],
      creditsUsedThisPeriod: 293,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/team/credit-usage",
      expect.objectContaining({
        headers: { Authorization: "Bearer fc-test" },
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/team/credit-usage/historical",
      expect.objectContaining({
        headers: { Authorization: "Bearer fc-test" },
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/team/credit-usage/historical?byApiKey=true",
      expect.objectContaining({
        headers: { Authorization: "Bearer fc-test" },
      })
    );
  });

  it("keeps remaining above planCredits rather than treating surplus as a parse error", async () => {
    stubApi((url) => {
      if (url.includes("historical")) return jsonReply({ success: true, periods: [] });
      return jsonReply(SAMPLE);
    });
    const res = await getFirecrawlUsage(CONFIG);
    expect(res.ok).toBe(true);
    expect(res.remainingCredits).toBeGreaterThan(res.planCredits);
  });

  it("still shows remaining/plan when historical fails", async () => {
    stubApi((url) => {
      if (url.includes("historical")) return jsonReply({}, 500);
      return jsonReply(SAMPLE);
    });
    const res = await getFirecrawlUsage(CONFIG);
    expect(res).toMatchObject({
      ok: true,
      remainingCredits: 5207,
      planCredits: 5000,
      periods: [],
      byKey: [],
    });
    expect(res.creditsUsedThisPeriod).toBeUndefined();
  });

  it("reads creditsUsed when the controller uses that name instead of totalCredits", async () => {
    stubApi((url) => {
      if (url.includes("byApiKey")) return jsonReply({ success: true, periods: [] });
      if (url.includes("historical")) {
        return jsonReply({
          success: true,
          periods: [
            {
              startDate: "2026-09-14T22:58:23.000Z",
              endDate: "2026-10-14T22:58:23.000Z",
              creditsUsed: 88,
            },
          ],
        });
      }
      return jsonReply(SAMPLE);
    });
    const res = await getFirecrawlUsage(CONFIG);
    expect(res.creditsUsedThisPeriod).toBe(88);
    expect(res.periods[0].creditsUsed).toBe(88);
  });

  it("fails soft when the key is rejected", async () => {
    stubApi(() => jsonReply({}, 401));
    expect(await getFirecrawlUsage(CONFIG)).toMatchObject({
      ok: false,
      reason: "Firecrawl API key rejected",
    });
  });

  it("surfaces success:false from a 200 rather than inventing numbers", async () => {
    stubApi((url) => {
      if (url.includes("historical")) return jsonReply({ success: true, periods: [] });
      return jsonReply({ success: false, error: "Could not find credit usage information" });
    });
    expect(await getFirecrawlUsage(CONFIG)).toEqual({
      ok: false,
      reason: "Could not find credit usage information",
      remainingCredits: 0,
      planCredits: 0,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      periods: [],
      byKey: [],
    });
  });
});
