import { afterEach, describe, expect, it, vi } from "vitest";
import { resetFetchBackoff } from "./http";
import { getRailwayUsage } from "./railway";

const CONFIG = { accountToken: "railway-test" };

function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function discovery(workspaces: unknown[]) {
  return {
    data: { me: { workspaces } },
  };
}

function workspace(
  id: string,
  name: string,
  start = "2026-09-01T00:00:00.000Z",
  end = "2026-10-01T00:00:00.000Z"
) {
  return {
    id,
    name,
    customer: {
      currentUsage: id === "one" ? 12 : 3,
      creditBalance: id === "one" ? 20 : 5,
      remainingUsageCreditBalance: id === "one" ? 8 : 2,
      appliedCredits: id === "one" ? 4 : 1,
      billingPeriod: { start, end },
      usageLimit: {
        softLimit: 25,
        hardLimit: 50,
        isOverLimit: false,
      },
    },
  };
}

function stubApi(handler: (query: string, variables: Record<string, unknown>) => Response) {
  const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    return handler(request.query, request.variables ?? {});
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("getRailwayUsage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetFetchBackoff();
  });

  it("fails soft with no token without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await getRailwayUsage({})).toMatchObject({
      ok: false,
      reason: "No Railway API token configured",
      workspaces: [],
      currentUsageDollars: 0,
      creditBalance: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aggregates current-cycle billing, credits, forecasts, and line items", async () => {
    const fetch = stubApi((query, variables) => {
      if (query.includes("RailwayBillingWorkspaces")) {
        return jsonReply(discovery([workspace("one", "Personal"), workspace("two", "Team")]));
      }
      if (variables.workspaceId === "one") {
        return jsonReply({
          data: {
            usage: [
              { measurement: "CPU_USAGE", value: 4320 },
              { measurement: "MEMORY_USAGE_GB", value: 4320 },
            ],
            estimatedUsage: [
              { measurement: "CPU_USAGE", estimatedValue: 8640 },
              { measurement: "MEMORY_USAGE_GB", estimatedValue: 8640 },
            ],
          },
        });
      }
      return jsonReply({
        data: {
          usage: [{ measurement: "NETWORK_TX_GB", value: 20 }],
          estimatedUsage: [{ measurement: "NETWORK_TX_GB", estimatedValue: 40 }],
        },
      });
    });

    const result = await getRailwayUsage(CONFIG);

    expect(result).toMatchObject({
      ok: true,
      currentUsageDollars: 15,
      estimatedBillDollars: 19,
      creditBalance: 25,
      remainingUsageCreditBalance: 10,
      appliedCredits: 5,
    });
    expect(result.workspaces[0]).toMatchObject({
      name: "Personal",
      currentUsageDollars: 12,
      estimatedBillDollars: 15,
      creditBalance: 20,
      remainingUsageCreditBalance: 8,
      appliedCredits: 4,
      usageLimit: { softLimit: 25, hardLimit: 50, isOverLimit: false },
    });
    expect(result.workspaces[1].estimatedBillDollars).toBe(4);
    expect(result.lineItems).toEqual([
      {
        key: "MEMORY_USAGE_GB",
        label: "Memory",
        currentUsageDollars: 1,
        estimatedUsageDollars: 2,
      },
      {
        key: "CPU_USAGE",
        label: "CPU",
        currentUsageDollars: 2,
        estimatedUsageDollars: 4,
      },
      {
        key: "NETWORK_TX_GB",
        label: "Egress",
        currentUsageDollars: 1,
        estimatedUsageDollars: 2,
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith(
      "https://backboard.railway.com/graphql/v2",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer railway-test",
          "Content-Type": "application/json",
        },
      })
    );
  });

  it("uses each workspace's own billing period", async () => {
    const fetch = stubApi((query, variables) => {
      if (query.includes("RailwayBillingWorkspaces")) {
        return jsonReply(
          discovery([
            workspace("one", "Personal", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"),
            workspace("two", "Team", "2026-09-15T00:00:00Z", "2026-10-15T00:00:00Z"),
          ])
        );
      }
      return jsonReply({ data: { usage: [], estimatedUsage: [] } });
    });

    await getRailwayUsage(CONFIG);

    const requests = fetch.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests.map((request) => [request.variables.startDate, request.variables.endDate])).toEqual([
      ["2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"],
      ["2026-09-15T00:00:00Z", "2026-10-15T00:00:00Z"],
    ]);
  });

  it("discovers workspace-token billing scope through accessible projects", async () => {
    const fetch = stubApi((query) => {
      if (query.includes("RailwayBillingWorkspaces")) {
        return jsonReply({
          data: null,
          errors: [{ message: "Not Authorized" }],
        });
      }
      if (query.includes("RailwayProjectWorkspaces")) {
        return jsonReply({
          data: {
            projects: {
              edges: [
                { node: { workspaceId: "one" } },
                { node: { workspaceId: "one" } },
              ],
            },
          },
        });
      }
      if (query.includes("RailwayBillingWorkspace")) {
        return jsonReply({ data: { workspace: workspace("one", "Personal") } });
      }
      return jsonReply({ data: { usage: [], estimatedUsage: [] } });
    });

    const result = await getRailwayUsage(CONFIG);

    expect(result).toMatchObject({
      ok: true,
      workspaces: [{ id: "one", name: "Personal", currentUsageDollars: 12 }],
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("preserves successful workspace billing when a detail query fails", async () => {
    stubApi((query, variables) => {
      if (query.includes("RailwayBillingWorkspaces")) {
        return jsonReply(discovery([workspace("one", "Personal"), workspace("two", "Team")]));
      }
      if (variables.workspaceId === "two") {
        return jsonReply({
          data: { usage: [] },
          errors: [{ message: "Estimate unavailable", extensions: { traceId: "trace-2" } }],
        });
      }
      return jsonReply({ data: { usage: [], estimatedUsage: [] } });
    });

    const result = await getRailwayUsage(CONFIG);

    expect(result.ok).toBe(true);
    expect(result.currentUsageDollars).toBe(15);
    expect(result.estimatedBillDollars).toBeUndefined();
    expect(result.workspaces[0].reason).toBeUndefined();
    expect(result.workspaces[1]).toMatchObject({
      name: "Team",
      currentUsageDollars: 3,
      reason: "Estimate unavailable (trace-2)",
    });
  });

  it("keeps a workspace with no attached billing customer as a partial row", async () => {
    stubApi(() =>
      jsonReply(discovery([{ id: "free", name: "Free workspace", customer: null }]))
    );

    const result = await getRailwayUsage(CONFIG);

    expect(result).toMatchObject({
      ok: true,
      workspaces: [
        {
          id: "free",
          name: "Free workspace",
          reason: "No billing account is attached to this workspace",
          lineItems: [],
        },
      ],
    });
  });

  it("fails soft on GraphQL errors returned with HTTP 200", async () => {
    stubApi((query) => {
      if (query.includes("RailwayBillingWorkspaces")) {
        return jsonReply({
          errors: [{ message: "Not Authorized", extensions: { traceId: "trace-auth" } }],
          data: null,
        });
      }
      return jsonReply({
        errors: [{ message: "Token has no projects", extensions: { traceId: "trace-projects" } }],
        data: null,
      });
    });

    expect(await getRailwayUsage(CONFIG)).toMatchObject({
      ok: false,
      reason: "Token has no projects (trace-projects)",
      workspaces: [],
    });
  });

  it("surfaces GraphQL validation errors returned with HTTP 400", async () => {
    stubApi(() =>
      jsonReply(
        {
          errors: [
            {
              message: "Cannot query field workspaces",
              extensions: { traceId: "trace-validation" },
            },
          ],
        },
        400
      )
    );

    expect(await getRailwayUsage(CONFIG)).toMatchObject({
      ok: false,
      reason: "Cannot query field workspaces (trace-validation)",
    });
  });

  it("reports a rejected API token", async () => {
    stubApi(() => jsonReply({}, 401));

    expect(await getRailwayUsage(CONFIG)).toMatchObject({
      ok: false,
      reason: "Railway API token rejected",
    });
  });
});
