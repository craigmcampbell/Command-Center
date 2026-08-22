// Talks to OpenRouter's API for usage-by-model, usage-by-key, and remaining
// credit balance. Requires a Management API key (created separately from a
// normal inference key, under OpenRouter's dashboard) — every endpoint used
// here (credits, keys, activity) rejects a regular inference key outright.
//
// Two things about OpenRouter's API shape this all depends on:
//
//  1. /activity is capped at the last 30 completed UTC days — no parameter
//     or pagination gets more history than that. One call, with no filters,
//     already returns the full 30-day window, so daily/weekly/30d periods
//     are all sliced client-side from a single fetch rather than refetched
//     per period.
//  2. Activity rows carry no key identifier — only a `model`. Grouping by
//     key means calling /activity once per key (filtered by its hash) and
//     merging the results client-side, labeled with that key's name from
//     /keys. Personal accounts have a handful of keys at most, so this
//     N+1 pattern is cheap in practice.

import type {
  AppConfig,
  OpenRouterPeriod,
  OpenRouterTokenTotals,
  OpenRouterUsageBucket,
  OpenRouterUsageResult,
} from "../../shared/types";

const API_ROOT = "https://openrouter.ai/api/v1";

interface ActivityRow {
  date: string;
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  usage: number;
}

interface KeyRow {
  name: string;
  hash: string;
  disabled: boolean;
}

interface CacheSlot {
  managementApiKey: string;
  fetchedAt: number;
  activity: ActivityRow[];
  keys: KeyRow[];
  keyActivity: Map<string, ActivityRow[]>;
  creditBalance: OpenRouterUsageResult["creditBalance"];
}

const CACHE_TTL_MS = 60_000;
let cache: CacheSlot | null = null;

function emptyTokens(): OpenRouterTokenTotals {
  return { prompt: 0, completion: 0, reasoning: 0 };
}

function addTokens(into: OpenRouterTokenTotals, row: ActivityRow): void {
  into.prompt += row.prompt_tokens;
  into.completion += row.completion_tokens;
  into.reasoning += row.reasoning_tokens;
}

function failResult(period: OpenRouterPeriod, reason: string): OpenRouterUsageResult {
  return {
    ok: false,
    reason,
    period,
    costUsd: 0,
    requests: 0,
    tokens: emptyTokens(),
    byModel: [],
    byKey: [],
    scanMs: 0,
  };
}

async function fetchJson(path: string, managementApiKey: string): Promise<unknown> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${managementApiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "OpenRouter management key rejected"
        : "OpenRouter request failed"
    );
  }
  return res.json();
}

async function refreshCache(managementApiKey: string): Promise<CacheSlot> {
  const [creditsRes, keysRes, activityRes] = await Promise.all([
    fetchJson("/credits", managementApiKey) as Promise<{ data: { total_credits: number; total_usage: number } }>,
    fetchJson("/keys", managementApiKey) as Promise<{ data: KeyRow[] }>,
    fetchJson("/activity", managementApiKey) as Promise<{ data: ActivityRow[] }>,
  ]);

  const keys = keysRes.data;
  const keyActivity = new Map<string, ActivityRow[]>();
  await Promise.all(
    keys.map(async (key) => {
      const res = (await fetchJson(
        `/activity?api_key_hash=${encodeURIComponent(key.hash)}`,
        managementApiKey
      )) as { data: ActivityRow[] };
      keyActivity.set(key.hash, res.data);
    })
  );

  const { total_credits: totalCredits, total_usage: totalUsage } = creditsRes.data;

  const slot: CacheSlot = {
    managementApiKey,
    fetchedAt: Date.now(),
    activity: activityRes.data,
    keys,
    keyActivity,
    creditBalance: { totalCredits, totalUsage, remaining: totalCredits - totalUsage },
  };
  cache = slot;
  return slot;
}

function periodDays(period: OpenRouterPeriod): number {
  if (period === "daily") return 1;
  if (period === "weekly") return 7;
  return 30;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function bucket(map: Map<string, OpenRouterUsageBucket>, key: string, label: string): OpenRouterUsageBucket {
  let b = map.get(key);
  if (!b) {
    b = { key, label, costUsd: 0, requests: 0, tokens: emptyTokens() };
    map.set(key, b);
  }
  return b;
}

export async function getOpenRouterUsage(
  settings: AppConfig["openrouter"],
  period: OpenRouterPeriod
): Promise<OpenRouterUsageResult> {
  const managementApiKey = settings?.managementApiKey;
  if (!managementApiKey) return failResult(period, "No OpenRouter management API key configured");

  const started = Date.now();
  let slot: CacheSlot;
  try {
    slot =
      cache && cache.managementApiKey === managementApiKey && Date.now() - cache.fetchedAt < CACHE_TTL_MS
        ? cache
        : await refreshCache(managementApiKey);
  } catch (err) {
    return failResult(period, (err as Error).message || "Couldn't reach OpenRouter");
  }

  const from = daysAgo(periodDays(period) - 1);
  const inWindow = (row: ActivityRow) => row.date >= from;

  const totals = { costUsd: 0, requests: 0, tokens: emptyTokens() };
  const byModel = new Map<string, OpenRouterUsageBucket>();
  for (const row of slot.activity.filter(inWindow)) {
    totals.costUsd += row.usage;
    totals.requests += row.requests;
    addTokens(totals.tokens, row);

    const model = bucket(byModel, row.model, row.model);
    model.costUsd += row.usage;
    model.requests += row.requests;
    addTokens(model.tokens, row);
  }

  const byKey = new Map<string, OpenRouterUsageBucket>();
  for (const key of slot.keys) {
    const rows = (slot.keyActivity.get(key.hash) ?? []).filter(inWindow);
    if (rows.length === 0) continue;
    const b = bucket(byKey, key.hash, key.name);
    for (const row of rows) {
      b.costUsd += row.usage;
      b.requests += row.requests;
      addTokens(b.tokens, row);
    }
  }

  const byCost = (a: OpenRouterUsageBucket, b: OpenRouterUsageBucket) => b.costUsd - a.costUsd;

  return {
    ok: true,
    period,
    costUsd: totals.costUsd,
    requests: totals.requests,
    tokens: totals.tokens,
    byModel: [...byModel.values()].sort(byCost),
    byKey: [...byKey.values()].sort(byCost),
    creditBalance: slot.creditBalance,
    scanMs: Date.now() - started,
  };
}
