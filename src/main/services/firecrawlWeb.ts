// Web search and page reading for the Assistant, through Firecrawl's v2 API
// (the key already used by the usage widget). Fails soft like the other
// services. Shapes checked against Firecrawl's docs:
//   POST /v2/search -> { success, data: { web: [{ url, title, description }] } }
//   POST /v2/scrape -> { success, data: { markdown, metadata: { title, sourceURL, statusCode } } }
//
// Everything returned is text off the open internet, so callers hand it to the
// model as data. Each call spends credits, which is why assistantTools.ts caps
// them per reply.

import type { FirecrawlScalarConfig } from "../../shared/types";

const API_ROOT = "https://api.firecrawl.dev/v2";
// Not fetchWithTimeout (20s): a heavy page can take longer to render, and a POST
// that spends credits must not be silently retried.
const TIMEOUT_MS = 45_000;

export const SEARCH_MAX_RESULTS = 10;
export const SEARCH_DEFAULT_RESULTS = 5;
export const QUERY_MAX_CHARS = 500;
export const PAGE_MAX_CHARS = 12_000;
const SNIPPET_MAX_CHARS = 300;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type WebResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Pages Firecrawl can't see, or that shouldn't be asked for: loopback, link-local
// and private ranges, and local-only names. Firecrawl fetches from its own
// servers, so these would fail anyway; refusing here also keeps internal
// addresses out of a third party's logs.
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true;
  if (!host.includes(".") && !host.includes(":")) return true; // a bare intranet name
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(":")) {
    return host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  }
  return false;
}

// The URL a tool call may fetch: http(s) only, no credentials, nothing private.
export function parseWebUrl(raw: string): URL | string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "That isn't a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http and https pages can be read";
  if (url.username || url.password) return "URLs with a login in them aren't allowed";
  if (isPrivateHost(url.hostname)) return "Local and private addresses can't be read";
  return url;
}

async function post(path: string, apiKey: string, body: unknown): Promise<WebResult<{ data: any }>> {
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "Couldn't reach Firecrawl" };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // Handled by the status below.
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "Firecrawl API key rejected" };
  if (res.status === 402) return { ok: false, reason: "Out of Firecrawl credits" };
  if (res.status === 429) return { ok: false, reason: "Firecrawl rate limit reached; try again shortly" };
  if (!res.ok || !json || json.success === false) {
    const detail = typeof json?.error === "string" ? `: ${clip(json.error, 160)}` : "";
    return { ok: false, reason: `Firecrawl request failed${detail}` };
  }
  return { ok: true, data: json.data };
}

export async function searchWeb(
  settings: FirecrawlScalarConfig | undefined,
  query: string,
  limit?: number
): Promise<WebResult<{ results: SearchHit[] }>> {
  const apiKey = settings?.apiKey?.trim();
  if (!apiKey) return { ok: false, reason: "No Firecrawl API key configured" };
  const q = query.replace(/\s+/g, " ").trim();
  if (!q) return { ok: false, reason: "query is required" };
  const count = Math.max(1, Math.min(Math.floor(limit ?? SEARCH_DEFAULT_RESULTS) || SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS));

  const res = await post("/search", apiKey, { query: q.slice(0, QUERY_MAX_CHARS), limit: count });
  if (!res.ok) return res;
  // v2 nests results under `web`; an older shape returned the array directly.
  const rows: any[] = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.web) ? res.data.web : [];
  const results: SearchHit[] = [];
  for (const row of rows) {
    const url = typeof row?.url === "string" ? parseWebUrl(row.url) : null;
    if (!url || typeof url === "string") continue;
    results.push({
      title: clip(String(row.title ?? "").replace(/\s+/g, " ").trim(), 160) || url.hostname,
      url: url.href,
      snippet: clip(String(row.description ?? "").replace(/\s+/g, " ").trim(), SNIPPET_MAX_CHARS),
    });
  }
  return { ok: true, results: results.slice(0, count) };
}

export async function scrapePage(
  settings: FirecrawlScalarConfig | undefined,
  rawUrl: string
): Promise<WebResult<{ url: string; title: string; content: string; truncated: boolean }>> {
  const apiKey = settings?.apiKey?.trim();
  if (!apiKey) return { ok: false, reason: "No Firecrawl API key configured" };
  const url = parseWebUrl(rawUrl);
  if (typeof url === "string") return { ok: false, reason: url };

  const res = await post("/scrape", apiKey, { url: url.href, formats: ["markdown"], onlyMainContent: true });
  if (!res.ok) return res;
  const markdown = typeof res.data?.markdown === "string" ? res.data.markdown.trim() : "";
  if (!markdown) return { ok: false, reason: "The page had no readable text" };
  const status = Number(res.data?.metadata?.statusCode);
  if (Number.isFinite(status) && status >= 400) return { ok: false, reason: `The page returned HTTP ${status}` };
  return {
    ok: true,
    url: url.href,
    title: clip(String(res.data?.metadata?.title ?? "").replace(/\s+/g, " ").trim(), 160),
    content: markdown.slice(0, PAGE_MAX_CHARS),
    truncated: markdown.length > PAGE_MAX_CHARS,
  };
}
