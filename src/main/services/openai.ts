// Talks to OpenAI's organization Admin API for usage-by-model and cost-by-
// line-item. Requires an Admin API key (created separately from a normal
// project API key, under the org's Settings → Organization → Admin keys) —
// both endpoints used here reject a regular project key outright.
//
// Two things about OpenAI's API shape this depends on:
//
//  1. Usage and cost are two genuinely separate endpoints with different
//     grouping capabilities. /organization/usage/completions can group by
//     model but carries no dollar figure; /organization/costs can group by
//     line item/project/API key but never by model. There's no single call
//     that returns "cost per model" — the by-model table below is
//     tokens/requests only, and cost only ever appears in the by-line-item
//     table. Don't try to join them; OpenAI doesn't expose the mapping.
//  2. Both endpoints paginate by time bucket (bucket_width=1d here), not by
//     row — a `page` cursor with `has_more` when the requested window spans
//     more buckets than `limit`. Requesting `limit` = the number of days in
//     the window covers typical personal usage in one call; the pagination
//     loop below exists for correctness on wider orgs, capped at a sane
//     number of iterations rather than looping forever on a misbehaving API.
//
// Unlike OpenRouter, there is no documented endpoint for remaining credit
// balance — OpenAI's pay-as-you-go billing doesn't expose one via the public
// API, only the web dashboard. This service deliberately doesn't try to
// approximate one (e.g. via /organization/spend_limit, which is a
// configured hard cap, not a real balance).

import type {
  AppConfig,
  OpenAICostBucket,
  OpenAIPeriod,
  OpenAITokenTotals,
  OpenAIUsageBucket,
  OpenAIUsageResult,
} from "../../shared/types";

const API_ROOT = "https://api.openai.com/v1";

interface UsageCompletionsResultRow {
  input_tokens: number;
  input_cached_tokens?: number;
  output_tokens: number;
  num_model_requests: number;
  model?: string;
}

interface CostsResultRow {
  amount: { value: number; currency: string };
  line_item: string | null;
}

interface Bucket<T> {
  start_time: number;
  end_time: number;
  results: T[];
}

interface PagedResponse<T> {
  data: T[];
  has_more: boolean;
  next_page: string | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { fetchedAt: number; result: OpenAIUsageResult }>();

function emptyTokens(): OpenAITokenTotals {
  return { input: 0, cached: 0, output: 0 };
}

function failResult(period: OpenAIPeriod, reason: string): OpenAIUsageResult {
  return {
    ok: false,
    reason,
    period,
    costUsd: 0,
    requests: 0,
    tokens: emptyTokens(),
    byModel: [],
    byLineItem: [],
    scanMs: 0,
  };
}

async function fetchJson(path: string, adminApiKey: string): Promise<unknown> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${adminApiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "OpenAI admin key rejected"
        : "OpenAI request failed"
    );
  }
  return res.json();
}

// Walks the `page`/`has_more` cursor, flattening every bucket's `results`
// into one array. Capped at 20 pages — comfortably past what a personal
// account's 30-day window needs, without looping forever on a misbehaving
// response.
async function fetchAllResults<T>(
  path: string,
  adminApiKey: string,
  params: URLSearchParams
): Promise<T[]> {
  const out: T[] = [];
  let page: string | undefined;
  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams(params);
    if (page) qs.set("page", page);
    const res = (await fetchJson(`${path}?${qs.toString()}`, adminApiKey)) as PagedResponse<
      Bucket<T>
    >;
    for (const bucket of res.data) out.push(...bucket.results);
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }
  return out;
}

function startOfUtcDay(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

function periodDays(period: OpenAIPeriod): number {
  if (period === "daily") return 1;
  return period === "weekly" ? 7 : 30;
}

// OpenAI's usage endpoint reports the current UTC day in real time (unlike
// OpenRouter's /activity, which never includes the day in progress), so
// "daily" can just mean "since today's UTC midnight" — no most-recent-
// completed-day pinning needed here.
function periodStartTime(period: OpenAIPeriod): number {
  return startOfUtcDay(new Date()) - (periodDays(period) - 1) * 86_400;
}

function bucketKey<T extends { key: string }>(map: Map<string, T>, key: string, make: () => T): T {
  let b = map.get(key);
  if (!b) {
    b = make();
    map.set(key, b);
  }
  return b;
}

export async function getOpenAIUsage(
  settings: AppConfig["openai"],
  period: OpenAIPeriod
): Promise<OpenAIUsageResult> {
  const adminApiKey = settings?.adminApiKey;
  if (!adminApiKey) return failResult(period, "No OpenAI admin API key configured");

  const cacheKey = `${adminApiKey}:${period}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result;

  const started = Date.now();
  const startTime = periodStartTime(period);
  const limit = Math.min(periodDays(period), 31);

  let usageRows: UsageCompletionsResultRow[];
  let costRows: CostsResultRow[];
  try {
    [usageRows, costRows] = await Promise.all([
      fetchAllResults<UsageCompletionsResultRow>(
        "/organization/usage/completions",
        adminApiKey,
        new URLSearchParams({
          start_time: String(startTime),
          bucket_width: "1d",
          limit: String(limit),
          group_by: "model",
        })
      ),
      fetchAllResults<CostsResultRow>(
        "/organization/costs",
        adminApiKey,
        new URLSearchParams({
          start_time: String(startTime),
          bucket_width: "1d",
          limit: String(limit),
          group_by: "line_item",
        })
      ),
    ]);
  } catch (err) {
    return failResult(period, (err as Error).message || "Couldn't reach OpenAI");
  }

  const totals = { requests: 0, tokens: emptyTokens() };
  const byModel = new Map<string, OpenAIUsageBucket>();
  for (const row of usageRows) {
    totals.requests += row.num_model_requests;
    totals.tokens.input += row.input_tokens;
    totals.tokens.cached += row.input_cached_tokens ?? 0;
    totals.tokens.output += row.output_tokens;

    const label = row.model ?? "unknown";
    const b = bucketKey(byModel, label, () => ({
      key: label,
      label,
      requests: 0,
      tokens: emptyTokens(),
    }));
    b.requests += row.num_model_requests;
    b.tokens.input += row.input_tokens;
    b.tokens.cached += row.input_cached_tokens ?? 0;
    b.tokens.output += row.output_tokens;
  }

  let costUsd = 0;
  const byLineItem = new Map<string, OpenAICostBucket>();
  for (const row of costRows) {
    costUsd += row.amount.value;
    const label = row.line_item ?? "Other";
    const b = bucketKey(byLineItem, label, () => ({ key: label, label, costUsd: 0 }));
    b.costUsd += row.amount.value;
  }

  const result: OpenAIUsageResult = {
    ok: true,
    period,
    costUsd,
    requests: totals.requests,
    tokens: totals.tokens,
    byModel: [...byModel.values()].sort((a, b) => b.requests - a.requests),
    byLineItem: [...byLineItem.values()].sort((a, b) => b.costUsd - a.costUsd),
    scanMs: Date.now() - started,
  };
  cache.set(cacheKey, { fetchedAt: Date.now(), result });
  return result;
}
