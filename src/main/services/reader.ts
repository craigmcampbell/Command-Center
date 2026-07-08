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

function buildResult(page: number): ReaderResult {
  const sorted = [...(cache?.docs ?? [])].sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  const start = page * PAGE_SIZE;
  const pageDocs = sorted.slice(start, start + PAGE_SIZE);

  return {
    ok: true,
    documents: pageDocs.map(toReaderDocument),
    page,
    hasNext: sorted.length > start + PAGE_SIZE || !(cache?.exhausted ?? true),
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

  const res = await fetch(url, { headers: { Authorization: `Token ${apiToken}` } });
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

  if (!cache || cache.token !== apiToken) {
    cache = { docs: [], nextCursor: null, exhausted: false, token: apiToken };
  }

  const needed = (page + 1) * PAGE_SIZE;
  try {
    while (cache.docs.length < needed && !cache.exhausted) {
      const { docs, nextCursor } = await fetchPage(apiToken, cache.nextCursor);
      const existingIds = new Set(cache.docs.map((d) => d.id));
      cache.docs.push(...docs.filter((d) => !existingIds.has(d.id)));
      cache.nextCursor = nextCursor;
      if (!nextCursor) cache.exhausted = true;
    }
  } catch (err) {
    return failResult(page, (err as Error).message || "Couldn't reach Readwise");
  }

  return buildResult(page);
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
    const res = await fetch(`${API_ROOT}/update/${encodeURIComponent(id)}/`, {
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
    const res = await fetch(`${API_ROOT}/delete/${encodeURIComponent(id)}/`, {
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
