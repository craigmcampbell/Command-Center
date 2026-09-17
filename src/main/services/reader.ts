import { fetchWithTimeout } from "./http";
// Talks to the Readwise Reader API (v3) for the "latest saved" list, plus
// archiving/deleting a document. Requires a personal API token
// (https://readwise.io/access_token) stored in config.json. Fails soft, like
// the other services.
//
// The API paginates by opaque cursor, not by offset, and has no "exclude
// feed" or "sort by saved date" params — so this module keeps a small
// in-memory cache of raw documents (accumulated across cursor pages,
// filtered, deduped by id) and does the sorting/paging client-side. The
// cache is invalidated whenever the configured token changes or a caller
// asks for a forced refresh (see resetReaderCache); archiving/deleting a
// document just removes it from the cache directly, no refetch needed.

import type { AppConfig, ReaderDocument, ReaderResult } from "../../shared/types";

const API_ROOT = "https://readwise.io/api/v3";
const PAGE_SIZE = 15;
const FETCH_LIMIT = 100; // max allowed per Reader API call
const CACHE_TTL_MS = 5 * 60_000;
// Readwise allows only 20 list requests/minute per token, shared with the
// Feed sub-tab (services/readerFeed.ts) via the same readwise.io origin's
// circuit breaker in http.ts — a burst here that trips a 429 locks out both
// sub-tabs for minutes. Pull at most one 100-item upstream page per UI
// request; a deep or stale page just comes back short until a later
// request (the next poll, or paging forward again) walks the cursor
// further. Same mitigation as readerFeed.ts's MAX_FETCH_PAGES_PER_CALL.
const MAX_FETCH_PAGES_PER_CALL = 1;

interface RawDoc {
  id: string;
  title: string;
  author: string;
  url: string;
  location: string;
  category: string;
  saved_at: string;
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

export function resetReaderCache(): void {
  cache = null;
}

function failResult(page: number, reason: string): ReaderResult {
  return { ok: false, reason, documents: [], page, hasNext: false, hasPrev: page > 0 };
}

function toReaderDocument(d: RawDoc): ReaderDocument {
  return {
    id: d.id,
    title: d.title || "Untitled",
    author: d.author || "",
    url: d.url,
    category: d.category,
    savedAt: d.saved_at,
  };
}

function buildResult(page: number, snapshot = cache): ReaderResult {
  const sorted = [...(snapshot?.docs ?? [])].sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  const start = page * PAGE_SIZE;
  const pageDocs = sorted.slice(start, start + PAGE_SIZE);

  return {
    ok: true,
    documents: pageDocs.map(toReaderDocument),
    page,
    // Only offer another page when it already exists locally, or this page is
    // full and one bounded upstream fetch could continue it. A short page —
    // e.g. one MAX_FETCH_PAGES_PER_CALL fetch wasn't enough to reach a deep
    // page — must not advertise a next page that comes back empty.
    hasNext:
      sorted.length > start + PAGE_SIZE ||
      (pageDocs.length === PAGE_SIZE && !(snapshot?.exhausted ?? true)),
    hasPrev: page > 0,
  };
}

async function fetchPage(
  apiToken: string,
  cursor: string | null
): Promise<{ docs: RawDoc[]; nextCursor: string | null }> {
  const url = new URL(`${API_ROOT}/list/`);
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
    (d: RawDoc) =>
      d.location !== "feed" &&
      d.category !== "highlight" &&
      d.category !== "note" &&
      !d.parent_id
  );
  return { docs, nextCursor: data.nextPageCursor || null };
}

export async function listReaderDocuments(
  { apiToken }: AppConfig["reader"],
  page: number
): Promise<ReaderResult> {
  if (!apiToken) return failResult(page, "No Readwise API token configured");

  if (!cache || cache.token !== apiToken || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    cache = { docs: [], nextCursor: null, exhausted: false, token: apiToken, fetchedAt: Date.now() };
  }

  const snapshot = cache;
  const needed = (page + 1) * PAGE_SIZE;
  let fetchedPages = 0;
  try {
    while (
      snapshot.docs.length < needed &&
      !snapshot.exhausted &&
      fetchedPages < MAX_FETCH_PAGES_PER_CALL
    ) {
      if (!snapshot.pending) {
        fetchedPages += 1;
        snapshot.pending = (async () => {
          const { docs, nextCursor } = await fetchPage(apiToken, snapshot.nextCursor);
          const existingIds = new Set(snapshot.docs.map((d) => d.id));
          snapshot.docs.push(...docs.filter((d) => !existingIds.has(d.id)));
          snapshot.nextCursor = nextCursor;
          if (!nextCursor) snapshot.exhausted = true;
        })().finally(() => { snapshot.pending = undefined; });
      }
      await snapshot.pending;
    }
  } catch (err) {
    return failResult(page, (err as Error).message || "Couldn't reach Readwise");
  }

  return buildResult(page, snapshot);
}

// Moves a document to Reader's Archive location — reversible from within
// Reader itself, just hidden from this widget's list going forward.
export async function archiveDocument(
  { apiToken }: AppConfig["reader"],
  id: string,
  page: number
): Promise<ReaderResult> {
  if (!apiToken) return failResult(page, "No Readwise API token configured");

  try {
    const res = await fetchWithTimeout(`${API_ROOT}/update/${encodeURIComponent(id)}/`, {
      method: "PATCH",
      headers: {
        Authorization: `Token ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ location: "archive" }),
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? "Readwise token rejected"
          : "Couldn't archive document"
      );
    }
  } catch (err) {
    return failResult(page, (err as Error).message || "Couldn't reach Readwise");
  }

  if (cache) cache.docs = cache.docs.filter((d) => d.id !== id);
  return buildResult(page);
}

// Permanently deletes a document from the user's Readwise account. No undo.
export async function deleteDocument(
  { apiToken }: AppConfig["reader"],
  id: string,
  page: number
): Promise<ReaderResult> {
  if (!apiToken) return failResult(page, "No Readwise API token configured");

  try {
    const res = await fetchWithTimeout(`${API_ROOT}/delete/${encodeURIComponent(id)}/`, {
      method: "DELETE",
      headers: { Authorization: `Token ${apiToken}` },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? "Readwise token rejected"
          : "Couldn't delete document"
      );
    }
  } catch (err) {
    return failResult(page, (err as Error).message || "Couldn't reach Readwise");
  }

  if (cache) cache.docs = cache.docs.filter((d) => d.id !== id);
  return buildResult(page);
}
