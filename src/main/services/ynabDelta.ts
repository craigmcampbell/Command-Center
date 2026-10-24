// YNAB "delta requests": send back the `server_knowledge` from the last
// response as `last_knowledge_of_server` and YNAB returns only what changed
// since — deleted rows included, flagged `deleted: true`. This keeps the last
// full picture per (token, plan, resource) and merges each delta into it, so a
// poll that finds nothing new costs one tiny response instead of re-sending
// every account, payee and transaction.
//
// In-memory only, deliberately: it is a cache of upstream state, a restart just
// means one full fetch, and nothing here is a second source of truth.
//
// Only safe for an unfiltered collection. A server-side filter such as
// `?type=unapproved` would never report a row that *left* the filter (an
// approved transaction), so the cached copy would keep it forever — which is why
// `getUnapprovedTransactions` still fetches in full and filters nothing here.

import { fetchWithTimeout } from "./http";
import type { YnabScalarConfig } from "../../shared/types";

export const API_ROOT = "https://api.ynab.com/v1";

export function ynabFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

// YNAB reports errors as a JSON body ({ error: { id, name, detail } }) rather
// than distinct headers, so this has to read the response body, unlike
// github.ts's header-only rate-limit check.
export async function ynabErrorReason(res: Response): Promise<string> {
  if (res.status === 401) return "YNAB token rejected";
  if (res.status === 429) return "Rate limited, try again later";
  try {
    const body = await res.json();
    if (body?.error?.detail) return body.error.detail;
  } catch {
    // fall through to the generic message below
  }
  return `YNAB request failed (${res.status})`;
}

interface Entry {
  knowledge: number;
  items: Map<string, any>;
}

const caches = new Map<string, Entry>();
const inflight = new Map<string, Promise<DeltaResult>>();

export type DeltaResult = { ok: true; items: any[] } | { ok: false; reason: string };

export function resetYnabDeltaCache(): void {
  caches.clear();
  inflight.clear();
}

export interface DeltaOptions {
  // Property on each row that identifies it. Everything is keyed by `id`
  // except months, which are keyed by their date.
  idField?: string;
  query?: Record<string, string>;
}

// `path` is relative to the plan ("accounts"); `field` is the array's name in
// the response's `data` ("accounts"). Concurrent calls for the same resource
// share one request — two widgets mounting together shouldn't each spend one.
export function fetchDelta(
  config: YnabScalarConfig,
  path: string,
  field: string,
  options: DeltaOptions = {}
): Promise<DeltaResult> {
  const { token, planId } = config;
  if (!token || !planId) return Promise.resolve({ ok: false, reason: "No YNAB token configured" });

  const query = new URLSearchParams(options.query ?? {});
  query.sort();
  const key = `${token}|${planId}|${path}|${query.toString()}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = load(key, token, planId, path, field, query, options.idField ?? "id").finally(() =>
    inflight.delete(key)
  );
  inflight.set(key, run);
  return run;
}

async function load(
  key: string,
  token: string,
  planId: string,
  path: string,
  field: string,
  query: URLSearchParams,
  idField: string
): Promise<DeltaResult> {
  const entry = caches.get(key);
  const params = new URLSearchParams(query);
  if (entry) params.set("last_knowledge_of_server", String(entry.knowledge));
  const qs = params.toString();

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/${path}${qs ? `?${qs}` : ""}`, token);
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB" };
  }
  if (!res.ok) return { ok: false, reason: await ynabErrorReason(res) };

  let data: any;
  try {
    data = (await res.json()).data ?? {};
  } catch {
    return { ok: false, reason: "YNAB sent a response this app couldn't read" };
  }

  const rows: any[] = Array.isArray(data[field]) ? data[field] : [];
  const knowledge = typeof data.server_knowledge === "number" ? data.server_knowledge : null;

  // A response with no server_knowledge can't be resumed from, so it replaces
  // rather than merges — and isn't cached, which keeps the next call a full
  // fetch instead of a delta against a baseline we never had.
  if (knowledge === null) {
    return { ok: true, items: rows.filter((r) => !r.deleted) };
  }

  const items = entry ? entry.items : new Map<string, any>();
  for (const row of rows) {
    const id = String(row[idField]);
    if (row.deleted) items.delete(id);
    else items.set(id, row);
  }
  caches.set(key, { knowledge, items });
  return { ok: true, items: Array.from(items.values()) };
}
