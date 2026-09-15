// Recent posts per subreddit, one sub-tab per configured subreddit. The tabs
// are derived from the result rather than from settings state, so adding or
// removing a subreddit in Settings shows up here on the next poll with no
// plumbing between the two.
//
// Every subreddit is fetched per poll (see services/reddit.ts), so switching
// tabs is instant and never shows a loading state.
//
// Titles, authors and flair are attacker-controllable text off the open
// internet: React text children only, and every URL through safeUrl().

import { useEffect, useState } from "react";
import Panel from "./Panel";
import { safeUrl } from "../lib/urls";
import type { RedditPost, RedditResult, RedditSubredditFeed } from "../../../shared/types";

function relativeTime(createdUtc: number): string {
  const minutes = Math.round((Date.now() - createdUtc * 1000) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

function compactScore(score: number): string {
  return score >= 1000 ? `${(score / 1000).toFixed(1)}k` : String(score);
}

function open(url: string) {
  const safe = safeUrl(url);
  if (safe) window.api.openUrl(safe);
}

function PostRow({ post }: { post: RedditPost }) {
  return (
    <div className="reddit-post">
      <div className="reddit-score">{compactScore(post.score)}</div>
      <div className="reddit-post-main">
        <button type="button" className="reddit-title" onClick={() => open(post.url)}>
          {post.title}
        </button>
        <div className="reddit-meta">
          {post.over18 && <span className="reddit-nsfw">NSFW</span>}
          {post.flair && <span className="reddit-flair">{post.flair}</span>}
          <span>u/{post.author}</span>
          <span>{relativeTime(post.createdUtc)}</span>
          {!post.isSelf && post.domain && <span className="reddit-domain">{post.domain}</span>}
          <button
            type="button"
            className="reddit-comments"
            onClick={() => open(post.permalink)}
            title="Open the discussion on Reddit"
          >
            {post.numComments} comments
          </button>
        </div>
      </div>
    </div>
  );
}

function FeedBody({ feed }: { feed: RedditSubredditFeed }) {
  if (!feed.ok) return <p className="muted">{feed.reason}.</p>;
  if (feed.posts.length === 0) return <p className="muted">No recent posts.</p>;
  return (
    <>
      {feed.posts.map((post) => (
        <PostRow key={post.id} post={post} />
      ))}
    </>
  );
}

export default function RedditWidget({ data }: { data: RedditResult | null }) {
  const [active, setActive] = useState<string | null>(null);

  const feeds = data?.ok ? data.subreddits : [];
  // Fall back to the first subreddit whenever the selected one disappears from
  // a later result — removing it in Settings would otherwise strand the widget
  // on a tab that no longer exists.
  const current = feeds.find((f) => f.subreddit === active) ?? feeds[0];
  useEffect(() => {
    if (current && current.subreddit !== active) setActive(current.subreddit);
  }, [current, active]);

  let body;
  if (!data) {
    body = <p className="muted">Loading Reddit…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}.</p>;
  } else if (!current) {
    body = <p className="muted">No subreddits configured — add some in Settings → Social.</p>;
  } else {
    body = <FeedBody feed={current} />;
  }

  const tabs = feeds.length > 0 && (
    <div className="reddit-subtabs" role="tablist" aria-label="Subreddit">
      {feeds.map((feed) => (
        <button
          key={feed.subreddit}
          type="button"
          role="tab"
          aria-selected={feed.subreddit === current?.subreddit}
          className={`reddit-subtab ${feed.subreddit === current?.subreddit ? "active" : ""} ${
            feed.ok ? "" : "failed"
          }`}
          onClick={() => setActive(feed.subreddit)}
        >
          r/{feed.subreddit}
        </button>
      ))}
    </div>
  );

  return (
    <Panel title="Reddit" headerRight={tabs || undefined}>
      {body}
    </Panel>
  );
}
