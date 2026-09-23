import type {
  RailwayScalarConfig,
  RailwayServiceUsage,
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

// A separate request from USAGE_QUERY so a failure here only loses the
// breakdown, not the workspace totals and forecast. Volume and backup usage
// come back tagged with the service the volume is mounted on, so grouping by
// service accounts for the whole metered total.
const SERVICE_USAGE_QUERY = `
  query RailwayServiceUsage(
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
      groupBy: [PROJECT_ID, SERVICE_ID]
    ) {
      measurement
      value
      tags {
        projectId
        serviceId
      }
    }
    projects(workspaceId: $workspaceId, includeDeleted: true, first: 500) {
      edges {
        node {
          id
          name
          services {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
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
  tags?: { projectId?: string | null; serviceId?: string | null } | null;
}

interface ProjectBody {
  id?: string;
  name?: string;
  services?: { edges?: { node?: { id?: string; name?: string } }[] } | null;
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
    if (!isMeasurement(sample.measurement)) continue;
    const measurement = sample.measurement;
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

function isMeasurement(value: string | undefined): value is (typeof MEASUREMENTS)[number] {
  return MEASUREMENTS.includes(value as (typeof MEASUREMENTS)[number]);
}

function serviceBreakdown(
  workspaceId: string,
  samples: UsageSample[],
  projects: ProjectBody[]
): RailwayServiceUsage[] {
  const projectNames = new Map<string, string>();
  const serviceNames = new Map<string, string>();
  for (const project of projects) {
    if (project.id) projectNames.set(project.id, project.name || "Unnamed project");
    for (const edge of project.services?.edges ?? []) {
      if (edge.node?.id) serviceNames.set(edge.node.id, edge.node.name || "Unnamed service");
    }
  }

  const rows = new Map<
    string,
    { projectId: string | null; serviceId: string | null; costs: Map<string, number> }
  >();
  for (const sample of samples) {
    if (!isMeasurement(sample.measurement)) continue;
    const projectId = sample.tags?.projectId ?? null;
    const serviceId = sample.tags?.serviceId ?? null;
    const key = `${workspaceId}:${projectId ?? "-"}:${serviceId ?? "-"}`;
    let row = rows.get(key);
    if (!row) {
      row = { projectId, serviceId, costs: new Map() };
      rows.set(key, row);
    }
    const cost = number(sample.value) * PRICES[sample.measurement];
    row.costs.set(sample.measurement, (row.costs.get(sample.measurement) ?? 0) + cost);
  }

  return [...rows.entries()]
    .map(([key, row]): RailwayServiceUsage => ({
      key,
      workspaceId,
      projectId: row.projectId,
      // includeDeleted keeps a deleted service's spend in the totals, but the
      // name lookup can't return it, so it needs a label of its own.
      projectName: row.projectId
        ? (projectNames.get(row.projectId) ?? "Deleted project")
        : "No project",
      serviceId: row.serviceId,
      serviceName: row.serviceId
        ? (serviceNames.get(row.serviceId) ?? "Deleted service")
        : "Project-level usage",
      currentUsageDollars: total(row.costs),
      lineItems: lineItems(row.costs, new Map()),
    }))
    .filter((row) => row.currentUsageDollars > 0)
    .sort((a, b) => b.currentUsageDollars - a.currentUsageDollars);
}

async function loadServiceUsage(
  token: string,
  workspace: RailwayWorkspaceUsage,
  variables: Record<string, unknown>
): Promise<Pick<RailwayWorkspaceUsage, "services" | "servicesReason">> {
  try {
    const body = await graphql<{
      usage?: UsageSample[];
      projects?: { edges?: { node?: ProjectBody }[] };
    }>(token, SERVICE_USAGE_QUERY, variables);
    if (!body.data?.usage) {
      return {
        services: [],
        servicesReason: errorMessage(body.errors) ?? "Railway returned no service usage",
      };
    }
    const projects = (body.data.projects?.edges ?? [])
      .map((edge) => edge.node)
      .filter((project): project is ProjectBody => Boolean(project));
    return {
      services: serviceBreakdown(workspace.id, body.data.usage, projects),
      // Usage without names still sums correctly; a missing project list only
      // costs the labels, so report it without discarding the rows.
      servicesReason: errorMessage(body.errors),
    };
  } catch (error) {
    return {
      services: [],
      servicesReason: (error as Error).message || "Couldn't load Railway service usage",
    };
  }
}

async function addUsageDetails(
  token: string,
  workspace: RailwayWorkspaceUsage
): Promise<RailwayWorkspaceUsage> {
  if (!workspace.billingPeriodStart || !workspace.billingPeriodEnd) {
    return { ...workspace, reason: "Railway did not return a billing period" };
  }

  const variables = {
    workspaceId: workspace.id,
    measurements: MEASUREMENTS,
    startDate: workspace.billingPeriodStart,
    endDate: workspace.billingPeriodEnd,
  };
  const serviceUsage = loadServiceUsage(token, workspace, variables);

  try {
    const body = await graphql<{
      usage?: UsageSample[];
      estimatedUsage?: UsageSample[];
    }>(token, USAGE_QUERY, variables);
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
      ...(await serviceUsage),
      reason,
    };
  } catch (error) {
    return {
      ...workspace,
      ...(await serviceUsage),
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
    services: [],
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
        services: [],
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
      services: workspaces
        .flatMap((workspace) => workspace.services)
        .sort((a, b) => b.currentUsageDollars - a.currentUsageDollars),
      scanMs: performance.now() - started,
    };
  } catch (error) {
    return failResult(
      (error as Error).message || "Couldn't reach Railway",
      performance.now() - started
    );
  }
}
