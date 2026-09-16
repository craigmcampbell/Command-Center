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
// Already-read items are dropped the same way — the list API has no `seen`
// filter, so unread is `first_opened_at == null`, applied as we ingest.

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
// Readwise allows only 20 list requests/minute per token. Unread is a
// client-side filter, so a mostly-read account could otherwise burn through
// dozens of cursor pages in one call and rate-limit both Reader sub-tabs.
// Pull at most one 100-item upstream page per UI request; `hasNext` keeps
// pagination available and later requests continue from the cached cursor.
const MAX_FETCH_PAGES_PER_CALL = 1;

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
  // Ids marked seen this cache lifetime. The list API has no `seen` filter, so
  // a refill fetch after mark-as-read can return the same docs still looking
  // unopened; this set is what stops them sliding back onto the page.
  seenIds: Set<string>;
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

function isUnread(d: RawDoc, seenIds: Set<string>): boolean {
  // Readwise has no boolean for this: a document is unread precisely when it
  // has never been opened, and hasn't been marked seen by us this session.
  return !d.first_opened_at && !seenIds.has(d.id);
}

function matchingDocs(snapshot: Cache | null, source: string | null): RawDoc[] {
  const seenIds = snapshot?.seenIds ?? new Set<string>();
  return [...(snapshot?.docs ?? [])]
    .filter((d) => isUnread(d, seenIds) && (!source || (d.site_name || "unknown") === source))
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

function emptyCache(token: string): Cache {
  return {
    docs: [],
    nextCursor: null,
    exhausted: false,
    token,
    fetchedAt: Date.now(),
    seenIds: new Set(),
  };
}

function ingest(snapshot: Cache, docs: RawDoc[]): void {
  const existing = new Set(snapshot.docs.map((d) => d.id));
  snapshot.docs.push(
    ...docs.filter((d) => !existing.has(d.id) && isUnread(d, snapshot.seenIds))
  );
}

async function ensureFilled(
  apiToken: string,
  snapshot: Cache,
  page: number,
  source: string | null
): Promise<void> {
  // Unread and source filters are both applied client-side — the list API has
  // no `seen` query param — so enough has to be loaded for the *filtered* list
  // to fill the page. Otherwise a quiet source, or a feed that's mostly already
  // read, shows an empty page while items sit unfetched upstream.
  const needed = (page + 1) * PAGE_SIZE;
  const enough = () => matchingDocs(snapshot, source).length >= needed;
  let fetchedPages = 0;

  while (!enough() && !snapshot.exhausted && fetchedPages < MAX_FETCH_PAGES_PER_CALL) {
    if (!snapshot.pending) {
      fetchedPages += 1;
      snapshot.pending = (async () => {
        const { docs, nextCursor } = await fetchPage(apiToken, snapshot.nextCursor);
        ingest(snapshot, docs);
        snapshot.nextCursor = nextCursor;
        if (!nextCursor) snapshot.exhausted = true;
      })().finally(() => {
        snapshot.pending = undefined;
      });
    }
    await snapshot.pending;
  }
}

function buildResult(page: number, source: string | null, snapshot = cache): ReaderFeedResult {
  const unread = matchingDocs(snapshot, null);
  // Source counts are of unread items loaded so far, not the whole account —
  // matching what the list actually shows. Sorted alphabetically rather than
  // by volume: this is a list you scan for a name you already have in mind,
  // and a busiest-first order moves entries around as new items arrive.
  const counts = new Map<string, number>();
  for (const d of unread) {
    const name = d.site_name || "unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const sources = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    // sensitivity "base" so casing in a site name doesn't split the ordering.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const filtered = source ? unread.filter((d) => (d.site_name || "unknown") === source) : unread;
  const start = page * PAGE_SIZE;
  const pageDocs = filtered.slice(start, start + PAGE_SIZE);

  return {
    ok: true,
    items: pageDocs.map(toFeedItem),
    sources,
    page,
    // Only offer another page when it already exists locally, or this page is
    // full and one bounded upstream fetch could continue it. A short page must
    // not lead to an empty "next" page just because older read-heavy history
    // still exists upstream.
    hasNext:
      filtered.length > start + PAGE_SIZE ||
      (pageDocs.length === PAGE_SIZE && !(snapshot?.exhausted ?? true)),
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
    cache = emptyCache(apiToken);
  }
  const snapshot = cache;

  try {
    await ensureFilled(apiToken, snapshot, page, source);
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
  if (cache) {
    cache.docs = cache.docs.filter((d) => d.id !== id);
    try {
      await ensureFilled(apiToken, cache, page, source);
    } catch {
      // Move took; a refill miss just means a short page until the next poll.
    }
  }
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
    for (const id of ids) cache.seenIds.add(id);
    cache.docs = cache.docs.filter((d) => !marked.has(d.id));
    try {
      await ensureFilled(apiToken, cache, page, source);
    } catch {
      // Mark took; a refill miss just means a short page until the next poll.
    }
  }
  return buildResult(page, source);
}
