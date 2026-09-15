import { fetchWithTimeout } from "./http";
// The RSS half of Readwise Reader — documents in the `feed` location, which
// services/reader.ts deliberately filters out of the saved-articles river.
//
// Same account and same token as reader.ts; no new integration and nothing to
// configure. Subscriptions are managed in Reader itself, which is the right
// place for them — this is a view, not a feed manager.
//
// Unlike reader.ts, this filters server-side with `location=feed`. That file
// pages through everything and discards feed items client-side, which is fine
// at its scale but hopeless here: a real account has thousands of feed items.

import type {
  AppConfig,
  ReaderFeedItem,
  ReaderFeedResult,
} from "../../shared/types";

const API_ROOT = "https://readwise.io/api/v3";
const PAGE_SIZE = 15;
const FETCH_LIMIT = 100;
const BULK_LIMIT = 50; // the API's own cap per bulk_update request
const CACHE_TTL_MS = 5 * 60_000;

interface RawDoc {
  id: string;
  url: string;
  source_url: string | null;
  title: string | null;
  author: string | null;
  site_name: string | null;
  summary: string | null;
  image_url: string | null;
  published_date: string | null;
  saved_at: string;
  reading_time: string | null;
  first_opened_at: string | null;
  category: string;
  parent_id: string | null;
}

interface Cache {
  docs: RawDoc[];
  nextCursor: string | null;
  exhausted: boolean;
  token: string;
  fetchedAt: number;
  pending?: Promise<void>;
}

let cache: Cache | null = null;

export function resetReaderFeedCache(): void {
  cache = null;
}

function failResult(page: number, reason: string): ReaderFeedResult {
  return { ok: false, reason, items: [], sources: [], page, hasNext: false, hasPrev: page > 0 };
}

// Publishers routinely prepend a date, and sometimes a section name, straight
// into the RSS title — Anthropic's feed yields
// "Aug 26, 2026Societal ImpactsEnabling independent research…". Only the date
// is unambiguous enough to strip; anything more aggressive would start eating
// real titles, so the rest is left alone rather than guessed at.
const LEADING_DATE_RE =
  /^(?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2}\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]{2} \d{4})\s*/;

export function cleanFeedTitle(raw: string | null): string {
  return (raw ?? "").replace(LEADING_DATE_RE, "").trim() || "Untitled";
}

function toFeedItem(d: RawDoc): ReaderFeedItem {
  return {
    id: d.id,
    title: cleanFeedTitle(d.title),
    author: d.author || "",
    siteName: d.site_name || "",
    // Where clicking goes: the Reader copy, which is what the saved-articles
    // widget links to as well, so both halves of the tab behave the same.
    url: d.url,
    sourceUrl: d.source_url || undefined,
    summary: d.summary || undefined,
    imageUrl: d.image_url || undefined,
    publishedDate: d.published_date || undefined,
    savedAt: d.saved_at,
    readingTime: d.reading_time || undefined,
    // Readwise has no boolean for this: a document is unread precisely when it
    // has never been opened.
    unread: !d.first_opened_at,
  };
}

async function fetchPage(
  apiToken: string,
  cursor: string | null
): Promise<{ docs: RawDoc[]; nextCursor: string | null }> {
  const url = new URL(`${API_ROOT}/list/`);
  url.searchParams.set("location", "feed");
  url.searchParams.set("limit", String(FETCH_LIMIT));
  if (cursor) url.searchParams.set("pageCursor", cursor);

  const res = await fetchWithTimeout(url, { headers: { Authorization: `Token ${apiToken}` } });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Readwise token rejected"
        : "Readwise request failed"
    );
  }
  const data = await res.json();
  const docs: RawDoc[] = (data.results || []).filter(
    (d: RawDoc) => d.category !== "highlight" && d.category !== "note" && !d.parent_id
  );
  return { docs, nextCursor: data.nextPageCursor || null };
}

function sortedDocs(snapshot: Cache | null): RawDoc[] {
  return [...(snapshot?.docs ?? [])].sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

function buildResult(page: number, source: string | null, snapshot = cache): ReaderFeedResult {
  const all = sortedDocs(snapshot);
  // Every source seen so far, so the renderer can offer a filter without a
  // second request. Counts are of what's loaded, not of the whole account.
  // Sorted alphabetically rather than by volume: this is a list you scan for a
  // name you already have in mind, and a busiest-first order moves entries
  // around as new items arrive.
  const counts = new Map<string, number>();
  for (const d of all) {
    const name = d.site_name || "unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const sources = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    // sensitivity "base" so casing in a site name doesn't split the ordering.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const filtered = source ? all.filter((d) => (d.site_name || "unknown") === source) : all;
  const start = page * PAGE_SIZE;
  const pageDocs = filtered.slice(start, start + PAGE_SIZE);

  return {
    ok: true,
    items: pageDocs.map(toFeedItem),
    sources,
    page,
    // More locally, or more still to pull from the API.
    hasNext: filtered.length > start + PAGE_SIZE || !(snapshot?.exhausted ?? true),
    hasPrev: page > 0,
  };
}

export async function listReaderFeed(
  { apiToken }: AppConfig["reader"],
  page: number,
  source: string | null = null,
  forceRefresh = false
): Promise<ReaderFeedResult> {
  if (!apiToken) return failResult(page, "No Readwise API token configured");
  if (forceRefresh) cache = null;

  if (!cache || cache.token !== apiToken || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    cache = { docs: [], nextCursor: null, exhausted: false, token: apiToken, fetchedAt: Date.now() };
  }
  const snapshot = cache;

  try {
    // A source filter is applied client-side, so enough has to be loaded for
    // the *filtered* list to fill the page — otherwise filtering to a quiet
    // source shows an empty page while items sit unfetched upstream.
    const needed = (page + 1) * PAGE_SIZE;
    const enough = () =>
      (source
        ? snapshot.docs.filter((d) => (d.site_name || "unknown") === source).length
        : snapshot.docs.length) >= needed;

    while (!enough() && !snapshot.exhausted) {
      if (!snapshot.pending) {
        snapshot.pending = (async () => {
          const { docs, nextCursor } = await fetchPage(apiToken, snapshot.nextCursor);
          const existing = new Set(snapshot.docs.map((d) => d.id));
          snapshot.docs.push(...docs.filter((d) => !existing.has(d.id)));
          snapshot.nextCursor = nextCursor;
          if (!nextCursor) snapshot.exhausted = true;
        })().finally(() => {
          snapshot.pending = undefined;
        });
      }
      await snapshot.pending;
    }
  } catch (err) {
    return failResult(page, (err as Error).message || "Couldn't reach Readwise");
  }

  return buildResult(page, source, snapshot);
}

// Moves a feed item into the Reader inbox — the "I'll actually read this"
// gesture. It leaves the feed location, so it drops out of this list and shows
// up in the saved-articles widget instead.
export async function moveFeedItemToInbox(
  { apiToken }: AppConfig["reader"],
  id: string,
  page: number,
  source: string | null = null
): Promise<ReaderFeedResult> {
  if (!apiToken) return failResult(page, "No Readwise API token configured");
  try {
    const res = await fetchWithTimeout(`${API_ROOT}/update/${id}/`, {
      method: "PATCH",
      headers: { Authorization: `Token ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ location: "new" }),
    });
    if (!res.ok) throw new Error(`Readwise returned ${res.status}`);
  } catch (err) {
    return failResult(page, (err as Error).message || "Couldn't move that item");
  }
  // Drop it locally rather than refetching — same trick as reader.ts's archive.
  if (cache) cache.docs = cache.docs.filter((d) => d.id !== id);
  return buildResult(page, source);
}

// Marks the given items seen. Deliberately takes explicit ids rather than
// "everything": the account can hold thousands of feed items and the API caps
// a bulk request at 50, so an unbounded "mark all" would be a long burst of
// writes. The renderer passes what it has actually loaded.
export async function markFeedItemsSeen(
  { apiToken }: AppConfig["reader"],
  ids: string[],
  page: number,
  source: string | null = null
): Promise<ReaderFeedResult> {
  if (!apiToken) return failResult(page, "No Readwise API token configured");
  if (ids.length === 0) return buildResult(page, source);

  try {
    for (let i = 0; i < ids.length; i += BULK_LIMIT) {
      const batch = ids.slice(i, i + BULK_LIMIT);
      const res = await fetchWithTimeout(`${API_ROOT}/bulk_update/`, {
        method: "PATCH",
        headers: { Authorization: `Token ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ updates: batch.map((id) => ({ id, seen: true })) }),
      });
      // 207 is a partial success, which for "mark as read" is not worth
      // failing the whole gesture over — the cache update below reflects the
      // intent and the next refresh reconciles anything that didn't take.
      if (!res.ok && res.status !== 207) throw new Error(`Readwise returned ${res.status}`);
    }
  } catch (err) {
    return failResult(page, (err as Error).message || "Couldn't mark those as read");
  }

  const marked = new Set(ids);
  if (cache) {
    for (const doc of cache.docs) {
      if (marked.has(doc.id) && !doc.first_opened_at) doc.first_opened_at = new Date().toISOString();
    }
  }
  return buildResult(page, source);
}
