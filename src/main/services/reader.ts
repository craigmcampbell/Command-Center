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

import type { ActionResult, AppConfig, ReaderDocument, ReaderResult } from "../../shared/types";

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
//
// Raised to 4 because the saved list is now fetched per location (see below):
// the first call needs one page from each of three locations before it can
// order anything.
const MAX_FETCH_PAGES_PER_CALL = 4;

// The locations that make up "saved". The list API takes ONE `location` per
// request, and without it returns every document newest-UPDATED first — feed
// items included. A real account holds thousands of feed items, so an
// unfiltered 100-item page was mostly feed, got filtered away client-side, and
// left a handful of saved documents reaching back only a day or so. Asking for
// each location by name makes every fetched document one we actually show.
// Archive is left out on purpose: archiving from this widget moves a document
// there, and it is meant to stay gone.
const SAVED_LOCATIONS = ["new", "later", "shortlist"] as const;
type SavedLocation = (typeof SAVED_LOCATIONS)[number];

interface RawDoc {
  id: string;
  title: string;
  author: string;
  url: string;
  location: string;
  category: string;
  saved_at: string;
  updated_at: string;
  parent_id: string | null;
  tags: Record<string, { name: string }>;
}

// Paging state for one location. The API lists newest-UPDATED first, so
// `oldestUpdated` (the smallest updated_at fetched so far, in ms) bounds what is
// still upstream: anything not yet fetched was updated no later than that, and a
// document is never saved after it was last updated — so every document SAVED
// after `oldestUpdated` is guaranteed to be here already.
interface LocationState {
  nextCursor: string | null;
  exhausted: boolean;
  oldestUpdated: number | null;
}

interface Cache {
  docs: RawDoc[];
  locations: Record<SavedLocation, LocationState>;
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
    tags: Object.keys(d.tags || {}),
  };
}

function freshCache(token: string): Cache {
  const state = (): LocationState => ({ nextCursor: null, exhausted: false, oldestUpdated: null });
  return {
    docs: [],
    locations: { new: state(), later: state(), shortlist: state() },
    token,
    fetchedAt: Date.now(),
  };
}

function allExhausted(snapshot: Cache | null): boolean {
  return !snapshot || SAVED_LOCATIONS.every((l) => snapshot.locations[l].exhausted);
}

// Documents are fetched newest-first per location, so merging locations is only
// correct down to the point every still-paging location has reached. Showing
// anything older would let a document from a location we haven't paged that far
// yet be silently missing from the middle of the list.
function horizon(snapshot: Cache | null): number {
  if (!snapshot) return -Infinity;
  let h = -Infinity;
  for (const l of SAVED_LOCATIONS) {
    const state = snapshot.locations[l];
    if (state.exhausted) continue;
    // Not fetched at all yet: nothing is known to be complete.
    if (state.oldestUpdated === null) return Infinity;
    h = Math.max(h, state.oldestUpdated);
  }
  return h;
}

function visibleDocs(snapshot: Cache | null): RawDoc[] {
  const h = horizon(snapshot);
  return [...(snapshot?.docs ?? [])]
    .filter((d) => Date.parse(d.saved_at) >= h)
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

function buildResult(page: number, snapshot = cache): ReaderResult {
  const sorted = visibleDocs(snapshot);
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
      (pageDocs.length === PAGE_SIZE && !allExhausted(snapshot)),
    hasPrev: page > 0,
  };
}

async function fetchPage(
  apiToken: string,
  location: SavedLocation,
  cursor: string | null
): Promise<{ docs: RawDoc[]; nextCursor: string | null; oldestUpdated: number | null }> {
  const url = new URL(`${API_ROOT}/list/`);
  url.searchParams.set("location", location);
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
  // Taken before filtering: a filtered-out row was still fetched, and the
  // bound is about how far down the upstream list we have read.
  const updated = (data.results || [])
    .map((d: RawDoc) => Date.parse(d.updated_at))
    .filter((n: number) => Number.isFinite(n));
  const oldestUpdated = updated.length > 0 ? Math.min(...updated) : null;
  const docs: RawDoc[] = (data.results || []).filter(
    (d: RawDoc) =>
      d.location !== "feed" &&
      d.category !== "highlight" &&
      d.category !== "note" &&
      !d.parent_id
  );
  return { docs, nextCursor: data.nextPageCursor || null, oldestUpdated };
}

export async function listReaderDocuments(
  { apiToken }: AppConfig["reader"],
  page: number
): Promise<ReaderResult> {
  if (!apiToken) return failResult(page, "No Readwise API token configured");

  if (!cache || cache.token !== apiToken || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    cache = freshCache(apiToken);
  }

  const snapshot = cache;
  const needed = (page + 1) * PAGE_SIZE;
  let fetchedPages = 0;
  try {
    while (
      visibleDocs(snapshot).length < needed &&
      !allExhausted(snapshot) &&
      fetchedPages < MAX_FETCH_PAGES_PER_CALL
    ) {
      if (snapshot.pending) {
        await snapshot.pending;
        continue;
      }
      // Next page from whichever location is holding the horizon back: one
      // not fetched yet first, then the one with the newest oldestUpdated.
      const location = SAVED_LOCATIONS.filter((l) => !snapshot.locations[l].exhausted).sort(
        (a, b) =>
          (snapshot.locations[b].oldestUpdated ?? Infinity) -
          (snapshot.locations[a].oldestUpdated ?? Infinity)
      )[0];
      const state = snapshot.locations[location];
      fetchedPages += 1;
      snapshot.pending = (async () => {
        const { docs, nextCursor, oldestUpdated } = await fetchPage(apiToken, location, state.nextCursor);
        const existingIds = new Set(snapshot.docs.map((d) => d.id));
        snapshot.docs.push(...docs.filter((d) => !existingIds.has(d.id)));
        state.nextCursor = nextCursor;
        if (oldestUpdated !== null) {
          state.oldestUpdated =
            state.oldestUpdated === null ? oldestUpdated : Math.min(state.oldestUpdated, oldestUpdated);
        }
        if (!nextCursor) state.exhausted = true;
      })().finally(() => {
        snapshot.pending = undefined;
      });
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

// Saves a URL to the Reader inbox (`location: new`, the API's default). 201 is
// a fresh save and 200 means Reader already had it — both are success, since
// the user's intent ("have this in Reader") holds either way. The saved list is
// cached, so drop it; the new document shows up on the next load.
export async function saveLink({ apiToken }: AppConfig["reader"], url: string): Promise<ActionResult> {
  if (!apiToken) return { ok: false, reason: "No Readwise API token configured" };
  try {
    const res = await fetchWithTimeout(`${API_ROOT}/save/`, {
      method: "POST",
      headers: { Authorization: `Token ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason:
          res.status === 401 || res.status === 403
            ? "Readwise token rejected"
            : `Couldn't save that link (${res.status})`,
      };
    }
  } catch {
    return { ok: false, reason: "Couldn't reach Readwise" };
  }
  cache = null;
  return { ok: true };
}
