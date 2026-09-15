import type {
  RailwayScalarConfig,
  RailwayUsageLineItem,
  RailwayUsageResult,
  RailwayWorkspaceUsage,
} from "../../shared/types";
import { fetchWithTimeout } from "./http";

const API_URL = "https://backboard.railway.com/graphql/v2";
const MINUTES_IN_MONTH = 43_200;

const MEASUREMENTS = [
  "MEMORY_USAGE_GB",
  "CPU_USAGE",
  "NETWORK_TX_GB",
  "DISK_USAGE_GB",
  "BACKUP_USAGE_GB",
] as const;

const PRICES: Record<(typeof MEASUREMENTS)[number], number> = {
  MEMORY_USAGE_GB: 10 / MINUTES_IN_MONTH,
  CPU_USAGE: 20 / MINUTES_IN_MONTH,
  NETWORK_TX_GB: 0.05,
  DISK_USAGE_GB: 0.15 / MINUTES_IN_MONTH,
  BACKUP_USAGE_GB: 0.15 / MINUTES_IN_MONTH,
};

const LABELS: Record<(typeof MEASUREMENTS)[number], string> = {
  MEMORY_USAGE_GB: "Memory",
  CPU_USAGE: "CPU",
  NETWORK_TX_GB: "Egress",
  DISK_USAGE_GB: "Volume",
  BACKUP_USAGE_GB: "Backup",
};

const WORKSPACE_FIELDS = `
  id
  name
  customer {
    currentUsage
    creditBalance
    remainingUsageCreditBalance
    appliedCredits
    billingPeriod {
      start
      end
    }
    usageLimit {
      softLimit
      hardLimit
      isOverLimit
    }
  }
`;

const ACCOUNT_WORKSPACES_QUERY = `
  query RailwayBillingWorkspaces {
    me {
      workspaces {
        ${WORKSPACE_FIELDS}
      }
    }
  }
`;

const PROJECT_WORKSPACES_QUERY = `
  query RailwayProjectWorkspaces {
    projects(first: 5000) {
      edges {
        node {
          workspaceId
        }
      }
    }
  }
`;

const WORKSPACE_QUERY = `
  query RailwayBillingWorkspace($workspaceId: String!) {
    workspace(workspaceId: $workspaceId) {
      ${WORKSPACE_FIELDS}
    }
  }
`;

const USAGE_QUERY = `
  query RailwayWorkspaceUsage(
    $workspaceId: String!
    $measurements: [MetricMeasurement!]!
    $startDate: DateTime!
    $endDate: DateTime!
  ) {
    usage(
      workspaceId: $workspaceId
      measurements: $measurements
      startDate: $startDate
      endDate: $endDate
      includeDeleted: true
    ) {
      measurement
      value
    }
    estimatedUsage(
      workspaceId: $workspaceId
      measurements: $measurements
      includeDeleted: true
    ) {
      measurement
      estimatedValue
    }
  }
`;

interface GraphqlError {
  message?: string;
  traceId?: string;
  extensions?: { traceId?: string };
}

interface GraphqlBody<T> {
  data?: T;
  errors?: GraphqlError[];
}

interface CustomerBody {
  currentUsage?: number | null;
  creditBalance?: number | null;
  remainingUsageCreditBalance?: number | null;
  appliedCredits?: number | null;
  billingPeriod?: { start?: string | null; end?: string | null } | null;
  usageLimit?: {
    softLimit?: number | null;
    hardLimit?: number | null;
    isOverLimit?: boolean | null;
  } | null;
}

interface WorkspaceBody {
  id?: string;
  name?: string;
  customer?: CustomerBody | null;
}

interface UsageSample {
  measurement?: string;
  value?: number;
  estimatedValue?: number;
}

function number(value: number | null | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

function errorMessage(errors: GraphqlError[] | undefined): string | undefined {
  const error = errors?.[0];
  if (!error) return undefined;
  const trace = error.traceId ?? error.extensions?.traceId;
  return `${error.message || "Railway request failed"}${trace ? ` (${trace})` : ""}`;
}

async function graphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphqlBody<T>> {
  const response = await fetchWithTimeout(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  let body: GraphqlBody<T> | undefined;
  try {
    body = (await response.json()) as GraphqlBody<T>;
  } catch {
    // The status-specific fallback below is more useful than a JSON parse error.
  }

  if (!response.ok) {
    const graphqlReason = errorMessage(body?.errors);
    throw new Error(
      graphqlReason ??
        (response.status === 401 || response.status === 403
          ? "Railway API token rejected"
          : response.status === 429
            ? "Railway rate limit exceeded"
            : `Railway request failed (${response.status})`)
    );
  }

  return body ?? {};
}

async function discoverWorkspaces(token: string): Promise<WorkspaceBody[]> {
  const account = await graphql<{ me?: { workspaces?: WorkspaceBody[] } }>(
    token,
    ACCOUNT_WORKSPACES_QUERY
  );
  if (account.data?.me?.workspaces) return account.data.me.workspaces;

  // `me` is account-token-only. A workspace token can still list its projects,
  // so use their workspace IDs to discover the billing scope instead.
  const projects = await graphql<{
    projects?: { edges?: { node?: { workspaceId?: string | null } }[] };
  }>(token, PROJECT_WORKSPACES_QUERY);
  const projectError = errorMessage(projects.errors);
  if (!projects.data?.projects) {
    throw new Error(projectError || errorMessage(account.errors) || "Railway token has no workspace access");
  }

  const ids = [
    ...new Set(
      (projects.data.projects.edges ?? [])
        .map((edge) => edge.node?.workspaceId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const results = await Promise.all(
    ids.map(async (workspaceId) => {
      const body = await graphql<{ workspace?: WorkspaceBody }>(token, WORKSPACE_QUERY, {
        workspaceId,
      });
      return body.data?.workspace;
    })
  );
  return results.filter((workspace): workspace is WorkspaceBody => Boolean(workspace));
}

function costByMeasurement(samples: UsageSample[], estimated: boolean): Map<string, number> {
  const values = new Map<string, number>();
  for (const sample of samples) {
    if (!MEASUREMENTS.includes(sample.measurement as (typeof MEASUREMENTS)[number])) continue;
    const measurement = sample.measurement as (typeof MEASUREMENTS)[number];
    const amount = estimated ? sample.estimatedValue : sample.value;
    values.set(measurement, (values.get(measurement) ?? 0) + number(amount) * PRICES[measurement]);
  }
  return values;
}

function lineItems(
  current: Map<string, number>,
  estimated: Map<string, number>
): RailwayUsageLineItem[] {
  return MEASUREMENTS.map((key) => ({
    key,
    label: LABELS[key],
    currentUsageDollars: current.get(key) ?? 0,
    estimatedUsageDollars: estimated.get(key),
  })).filter(
    (item) => item.currentUsageDollars > 0 || (item.estimatedUsageDollars ?? 0) > 0
  );
}

function total(items: Map<string, number>): number {
  return [...items.values()].reduce((sum, value) => sum + value, 0);
}

async function addUsageDetails(
  token: string,
  workspace: RailwayWorkspaceUsage
): Promise<RailwayWorkspaceUsage> {
  if (!workspace.billingPeriodStart || !workspace.billingPeriodEnd) {
    return { ...workspace, reason: "Railway did not return a billing period" };
  }

  try {
    const body = await graphql<{
      usage?: UsageSample[];
      estimatedUsage?: UsageSample[];
    }>(token, USAGE_QUERY, {
      workspaceId: workspace.id,
      measurements: MEASUREMENTS,
      startDate: workspace.billingPeriodStart,
      endDate: workspace.billingPeriodEnd,
    });
    const current = costByMeasurement(body.data?.usage ?? [], false);
    const estimated = costByMeasurement(body.data?.estimatedUsage ?? [], true);
    const currentFromMetrics = total(current);
    const estimatedFromMetrics = total(estimated);
    const reason = errorMessage(body.errors);

    return {
      ...workspace,
      estimatedBillDollars:
        body.data?.estimatedUsage != null
          ? estimatedFromMetrics +
            Math.max(workspace.currentUsageDollars - currentFromMetrics, 0)
          : undefined,
      lineItems: lineItems(current, estimated),
      reason,
    };
  } catch (error) {
    return {
      ...workspace,
      reason: (error as Error).message || "Couldn't load Railway usage details",
    };
  }
}

function aggregateLineItems(workspaces: RailwayWorkspaceUsage[]): RailwayUsageLineItem[] {
  const totals = new Map<string, RailwayUsageLineItem>();
  for (const workspace of workspaces) {
    for (const item of workspace.lineItems) {
      const existing = totals.get(item.key);
      if (existing) {
        existing.currentUsageDollars += item.currentUsageDollars;
        if (item.estimatedUsageDollars != null) {
          existing.estimatedUsageDollars =
            (existing.estimatedUsageDollars ?? 0) + item.estimatedUsageDollars;
        }
      } else {
        totals.set(item.key, { ...item });
      }
    }
  }
  return MEASUREMENTS.flatMap((key) => {
    const item = totals.get(key);
    return item ? [item] : [];
  });
}

function failResult(reason: string, scanMs: number): RailwayUsageResult {
  return {
    ok: false,
    reason,
    workspaces: [],
    currentUsageDollars: 0,
    creditBalance: 0,
    remainingUsageCreditBalance: 0,
    appliedCredits: 0,
    lineItems: [],
    scanMs,
  };
}

export async function getRailwayUsage(
  settings: RailwayScalarConfig | undefined
): Promise<RailwayUsageResult> {
  const started = performance.now();
  const token = settings?.accountToken?.trim();
  if (!token) return failResult("No Railway API token configured", performance.now() - started);

  try {
    const discovered = await discoverWorkspaces(token);
    const base = discovered.map((workspace, index): RailwayWorkspaceUsage => {
      const customer = workspace.customer;
      return {
        id: workspace.id || `workspace-${index}`,
        name: workspace.name || "Unnamed workspace",
        billingPeriodStart: customer?.billingPeriod?.start ?? null,
        billingPeriodEnd: customer?.billingPeriod?.end ?? null,
        currentUsageDollars: number(customer?.currentUsage),
        creditBalance: number(customer?.creditBalance),
        remainingUsageCreditBalance: number(customer?.remainingUsageCreditBalance),
        appliedCredits: number(customer?.appliedCredits),
        usageLimit: customer?.usageLimit
          ? {
              softLimit: customer.usageLimit.softLimit ?? null,
              hardLimit: customer.usageLimit.hardLimit ?? null,
              isOverLimit: customer.usageLimit.isOverLimit ?? false,
            }
          : undefined,
        lineItems: [],
        reason: customer ? undefined : "No billing account is attached to this workspace",
      };
    });

    const workspaces = await Promise.all(
      base.map((workspace) =>
        workspace.reason ? Promise.resolve(workspace) : addUsageDetails(token, workspace)
      )
    );
    const estimates = workspaces.map((workspace) => workspace.estimatedBillDollars);
    const hasAllEstimates = estimates.every((value) => value != null);

    return {
      ok: true,
      workspaces,
      currentUsageDollars: workspaces.reduce(
        (sum, workspace) => sum + workspace.currentUsageDollars,
        0
      ),
      estimatedBillDollars: hasAllEstimates
        ? estimates.reduce((sum, value) => sum + (value ?? 0), 0)
        : undefined,
      creditBalance: workspaces.reduce((sum, workspace) => sum + workspace.creditBalance, 0),
      remainingUsageCreditBalance: workspaces.reduce(
        (sum, workspace) => sum + workspace.remainingUsageCreditBalance,
        0
      ),
      appliedCredits: workspaces.reduce((sum, workspace) => sum + workspace.appliedCredits, 0),
      lineItems: aggregateLineItems(workspaces),
      scanMs: performance.now() - started,
    };
  } catch (error) {
    return failResult(
      (error as Error).message || "Couldn't reach Railway",
      performance.now() - started
    );
  }
}
