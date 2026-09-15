// Recent uploads from every configured channel as one side-scrolling strip,
// sorted newest-first across channels rather than grouped by channel — the
// point is "what's new", not "what has each channel posted".
//
// Everything rendered here (titles, channel names, thumbnail URLs) is
// attacker-controllable text off the open internet, so it goes in as React
// text children and every URL goes through safeUrl() first. See lib/urls.ts
// for why escaping alone isn't enough for an <img src>.

import { useRef, useState } from "react";
import Panel from "./Panel";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { safeUrl } from "../lib/urls";
import type { YouTubeResult, YouTubeVideo } from "../../../shared/types";

const SCROLL_STEP = 480; // roughly two cards

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return weeks < 5 ? `${weeks}w ago` : `${Math.round(days / 30)}mo ago`;
}

function VideoCard({ video }: { video: YouTubeVideo }) {
  // A thumbnail that 404s otherwise renders as the browser's broken-image
  // icon — a bright box that reads as a rendering fault against this palette.
  // Falling back to the empty well is quieter and just as honest.
  const [thumbBroken, setThumbBroken] = useState(false);
  const href = safeUrl(video.url);
  const thumbnail = thumbBroken ? null : safeUrl(video.thumbnailUrl);
  return (
    <button
      type="button"
      className="yt-card"
      disabled={!href}
      onClick={() => href && window.api.openUrl(href)}
      title={video.title}
    >
      <div className="yt-thumb">
        {thumbnail ? (
          <img src={thumbnail} alt="" loading="lazy" onError={() => setThumbBroken(true)} />
        ) : (
          <span className="yt-thumb-empty" />
        )}
      </div>
      <div className="yt-card-title">{video.title}</div>
      <div className="yt-card-meta">
        <span className="yt-card-channel">{video.channelTitle}</span>
        <span>{relativeTime(video.publishedAt)}</span>
      </div>
    </button>
  );
}

export default function YouTubeWidget({ data }: { data: YouTubeResult | null }) {
  const stripRef = useRef<HTMLDivElement>(null);

  function scrollBy(delta: number) {
    stripRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  let body;
  if (!data) {
    body = <p className="muted">Loading YouTube…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}.</p>;
  } else if (data.videos.length === 0) {
    body = <p className="muted">No channels configured — add some in Settings → Social.</p>;
  } else {
    body = (
      <>
        <div className="yt-strip" ref={stripRef}>
          {data.videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
        {data.failures.length > 0 && (
          <p className="muted yt-failures">
            {data.failures.map((f) => `${f.label}: ${f.reason}`).join(" · ")}
          </p>
        )}
      </>
    );
  }

  // Horizontal scroll is trackpad-only without these, which is awkward enough
  // on a mouse to justify the two buttons.
  const pager = data?.ok && data.videos.length > 0 && (
    <div className="yt-pager">
      <button type="button" onClick={() => scrollBy(-SCROLL_STEP)} aria-label="Scroll left">
        <IconChevronLeft />
      </button>
      <button type="button" onClick={() => scrollBy(SCROLL_STEP)} aria-label="Scroll right">
        <IconChevronRight />
      </button>
    </div>
  );

  return (
    <Panel title="YouTube" headerRight={pager || undefined}>
      {body}
    </Panel>
  );
}
