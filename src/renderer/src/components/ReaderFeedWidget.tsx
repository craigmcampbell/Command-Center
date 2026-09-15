// The RSS half of the Reader tab: Readwise's `feed` location, which the saved
// -articles widget filters out. Unread only — already-opened items never
// reach this list. Actions beyond reading: filter by source, mark one item
// (or the page) as read, move an item to the inbox.
//
// Titles, summaries and image URLs come from arbitrary publishers, so they go
// in as React text children and every URL through safeUrl().

import { useState } from "react";
import Panel from "./Panel";
import { IconArchive, IconCheck, IconChevronLeft, IconChevronRight } from "./icons";
import { safeUrl } from "../lib/urls";
import type { ReaderFeedItem, ReaderFeedResult } from "../../../shared/types";

function open(url: string) {
  const safe = safeUrl(url);
  if (safe) window.api.openUrl(safe);
}

function FeedRow({
  item,
  page,
  source,
  onChange,
}: {
  item: ReaderFeedItem;
  page: number;
  source: string | null;
  onChange: (r: ReaderFeedResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Feed cover images are arbitrary publisher URLs and a fair number 404 or
  // hotlink-block. Without this they render as the browser's broken-image
  // icon — a bright artefact against this palette. Same fallback as the
  // YouTube cards.
  const [thumbBroken, setThumbBroken] = useState(false);
  const thumb = item.imageUrl && !thumbBroken ? safeUrl(item.imageUrl) : null;

  async function markRead() {
    setBusy(true);
    const res = await window.api.reader.feedMarkSeen([item.id], page, source);
    if (res.ok) onChange(res);
    else {
      window.alert(res.reason || "Couldn't mark that as read.");
      setBusy(false);
    }
  }

  async function toInbox() {
    setBusy(true);
    const res = await window.api.reader.feedToInbox(item.id, page, source);
    if (res.ok) onChange(res);
    else {
      window.alert(res.reason || "Couldn't move that item.");
      setBusy(false);
    }
  }

  return (
    <div className={`feed-row ${busy ? "busy" : ""}`}>
      {thumb && (
        <img
          className="feed-thumb"
          src={thumb}
          alt=""
          loading="lazy"
          onError={() => setThumbBroken(true)}
        />
      )}
      <div className="feed-main">
        <button type="button" className="feed-title" onClick={() => open(item.url)}>
          {item.title}
        </button>
        {item.summary && <p className="feed-summary">{item.summary}</p>}
        <div className="feed-meta">
          <span className="feed-site">{item.siteName || item.author}</span>
          {item.publishedDate && <span>{item.publishedDate}</span>}
          {item.readingTime && <span>{item.readingTime}</span>}
        </div>
      </div>
      <span className="row-actions">
        <button
          className="row-action"
          onClick={markRead}
          disabled={busy}
          aria-label="Mark as read"
          title="Mark as read"
        >
          <IconCheck size={13} />
        </button>
        <button
          className="row-action"
          onClick={toInbox}
          disabled={busy}
          aria-label="Move to inbox"
          title="Move to Reader inbox"
        >
          <IconArchive />
        </button>
      </span>
    </div>
  );
}

export default function ReaderFeedWidget({
  data,
  source,
  onNavigate,
  onSource,
  onChange,
}: {
  data: ReaderFeedResult | null;
  source: string | null;
  onNavigate: (page: number) => void;
  onSource: (source: string | null) => void;
  onChange: (r: ReaderFeedResult) => void;
}) {
  const [marking, setMarking] = useState(false);

  // Bounded on purpose: this marks what's on screen, not all several-thousand
  // feed items, so the button can't turn into a long burst of writes.
  async function markPageRead() {
    if (!data) return;
    const unread = data.items.filter((i) => i.unread).map((i) => i.id);
    if (unread.length === 0) return;
    setMarking(true);
    const res = await window.api.reader.feedMarkSeen(unread, data.page, source);
    setMarking(false);
    if (res.ok) onChange(res);
    else window.alert(res.reason || "Couldn't mark those as read.");
  }

  let body;
  if (!data) {
    body = <p className="muted">Loading feed…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}.</p>;
  } else if (data.items.length === 0) {
    body = (
      <p className="muted">
        {source ? `Nothing unread from ${source}.` : "Caught up — no unread feed items."}
      </p>
    );
  } else {
    body = data.items.map((item) => (
      <FeedRow key={item.id} item={item} page={data.page} source={source} onChange={onChange} />
    ));
  }

  const unreadOnPage = data?.ok ? data.items.filter((i) => i.unread).length : 0;

  const controls = (
    <div className="feed-controls">
      {data?.ok && data.sources.length > 0 && (
        <select
          className="feed-source"
          value={source ?? ""}
          onChange={(e) => onSource(e.target.value || null)}
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {data.sources.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.count})
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="feed-mark"
        onClick={markPageRead}
        disabled={unreadOnPage === 0 || marking}
        title="Mark the items on this page as read"
      >
        {marking ? "Marking…" : `Mark ${unreadOnPage} read`}
      </button>
      <div className="yt-pager">
        <button
          type="button"
          onClick={() => data && onNavigate(data.page - 1)}
          disabled={!data?.hasPrev}
          aria-label="Previous page"
        >
          <IconChevronLeft />
        </button>
        <button
          type="button"
          onClick={() => data && onNavigate(data.page + 1)}
          disabled={!data?.hasNext}
          aria-label="Next page"
        >
          <IconChevronRight />
        </button>
      </div>
    </div>
  );

  return (
    <Panel title="Feed" headerRight={controls}>
      {body}
    </Panel>
  );
}
