import { fetchWithTimeout } from "./http";
// Team credit usage from Firecrawl's v2 API.
//
// GET /v2/team/credit-usage is remaining / plan / billing period.
// remainingCredits can exceed planCredits: planCredits is the subscription
// allotment and excludes coupons, credit packs, and auto-recharge — so
// "used" is never plan - remaining. Actual spend comes from
// GET /v2/team/credit-usage/historical (month buckets, optional byApiKey).
// Historical is additive: if it fails, remaining/plan still show.

import type {
  FirecrawlKeyBucket,
  FirecrawlPeriod,
  FirecrawlScalarConfig,
  FirecrawlUsageResult,
} from "../../shared/types";

const API_ROOT = "https://api.firecrawl.dev/v2";

interface CreditUsageBody {
  success?: boolean;
  error?: string;
  data?: {
    remainingCredits?: number;
    planCredits?: number;
    billingPeriodStart?: string | null;
    billingPeriodEnd?: string | null;
  };
}

interface HistoricalBody {
  success?: boolean;
  error?: string;
  periods?: HistoricalRow[];
}

interface HistoricalRow {
  startDate?: string | null;
  endDate?: string | null;
  apiKey?: string | null;
  // OpenAPI says totalCredits; the controller emits creditsUsed. Accept both.
  totalCredits?: number;
  creditsUsed?: number;
}

function failResult(reason: string): FirecrawlUsageResult {
  return {
    ok: false,
    reason,
    remainingCredits: 0,
    planCredits: 0,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    periods: [],
    byKey: [],
  };
}

function rowCredits(row: HistoricalRow): number {
  return row.totalCredits ?? row.creditsUsed ?? 0;
}

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function mapPeriods(rows: HistoricalRow[]): FirecrawlPeriod[] {
  return rows
    .map((row) => ({
      startDate: row.startDate ?? null,
      endDate: row.endDate ?? null,
      creditsUsed: rowCredits(row),
    }))
    .sort((a, b) => (instant(a.startDate) ?? Infinity) - (instant(b.startDate) ?? Infinity));
}

function matchThisPeriod(
  periods: FirecrawlPeriod[],
  billingPeriodStart: string | null
): FirecrawlPeriod | undefined {
  const start = instant(billingPeriodStart);
  if (start != null) {
    const hit = periods.find((p) => instant(p.startDate) === start);
    if (hit) return hit;
  }
  for (let i = periods.length - 1; i >= 0; i--) {
    if (instant(periods[i].startDate) != null) return periods[i];
  }
  return undefined;
}

function mapKeys(rows: HistoricalRow[], periodStart: string | null): FirecrawlKeyBucket[] {
  const start = instant(periodStart);
  const inPeriod = start == null ? rows : rows.filter((row) => instant(row.startDate) === start);
  const byName = new Map<string, FirecrawlKeyBucket>();
  for (const row of inPeriod) {
    const name = row.apiKey?.trim();
    if (!name) continue;
    const existing = byName.get(name);
    if (existing) existing.creditsUsed += rowCredits(row);
    else byName.set(name, { key: name, label: name, creditsUsed: rowCredits(row) });
  }
  return [...byName.values()].sort((a, b) => b.creditsUsed - a.creditsUsed);
}

async function fetchJson(path: string, apiKey: string): Promise<unknown> {
  const res = await fetchWithTimeout(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Firecrawl API key rejected"
        : "Firecrawl request failed"
    );
  }
  return res.json();
}

async function fetchHistorical(apiKey: string, byApiKey: boolean): Promise<HistoricalRow[]> {
  const path = byApiKey
    ? "/team/credit-usage/historical?byApiKey=true"
    : "/team/credit-usage/historical";
  const body = (await fetchJson(path, apiKey)) as HistoricalBody;
  if (!body.success) throw new Error(body.error || "Firecrawl request failed");
  return body.periods ?? [];
}

export async function getFirecrawlUsage(
  settings: FirecrawlScalarConfig | undefined
): Promise<FirecrawlUsageResult> {
  const apiKey = settings?.apiKey;
  if (!apiKey) return failResult("No Firecrawl API key configured");

  try {
    const [currentBody, historicalRows, keyRows] = await Promise.all([
      fetchJson("/team/credit-usage", apiKey) as Promise<CreditUsageBody>,
      fetchHistorical(apiKey, false).catch(() => null),
      fetchHistorical(apiKey, true).catch(() => null),
    ]);

    if (!currentBody.success || !currentBody.data) {
      return failResult(currentBody.error || "Firecrawl request failed");
    }

    const billingPeriodStart = currentBody.data.billingPeriodStart ?? null;
    const periods = historicalRows ? mapPeriods(historicalRows) : [];
    const thisPeriod = matchThisPeriod(periods, billingPeriodStart);
    const byKey = keyRows ? mapKeys(keyRows, thisPeriod?.startDate ?? billingPeriodStart) : [];

    return {
      ok: true,
      remainingCredits: currentBody.data.remainingCredits ?? 0,
      planCredits: currentBody.data.planCredits ?? 0,
      billingPeriodStart,
      billingPeriodEnd: currentBody.data.billingPeriodEnd ?? null,
      periods,
      byKey,
      creditsUsedThisPeriod: thisPeriod?.creditsUsed,
    };
  } catch (err) {
    return failResult((err as Error).message || "Couldn't reach Firecrawl");
  }
}
