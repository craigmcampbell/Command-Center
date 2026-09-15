// What counts as a way of naming a YouTube channel, shared by the Settings
// form and the main-process resolver — same one-definition reason as
// shared/subreddit.ts and shared/accelerator.ts.
//
// The feed endpoint only accepts a channel ID (`UC…`), but nobody knows their
// own channel ID and YouTube doesn't show it anywhere obvious. A @handle is
// what's actually visible, so accept that (and the URL forms people paste)
// and let services/youtube.ts resolve it to an ID once, when the channel is
// added.

// UC + 22 more characters of the URL-safe base64 alphabet.
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
// Handles are 3–30 characters; YouTube allows letters, digits, dot, dash,
// underscore. The `@` is stripped before testing.
const HANDLE_RE = /^[A-Za-z0-9._-]{3,30}$/;
// Legacy vanity paths (/c/Name, /user/Name) still resolve, so keep accepting
// them — they're what older links and bookmarks contain.
const LEGACY_RE = /^(c|user)\/[A-Za-z0-9._-]{1,100}$/;

// Playlist IDs are PL…/UU…/LL…/FL…/OLAK…; channel IDs are always UC + 22. The
// two take different feed parameters, so they stay distinguishable all the way
// through rather than being flattened into one "id".
const PLAYLIST_ID_RE = /^(?:PL|UU|LL|FL|RD|OLAK)[A-Za-z0-9_-]{10,}$/;

export type ChannelInput =
  // Already an ID: no lookup needed beyond confirming it exists.
  | { kind: "id"; channelId: string }
  // A playlist, which the feed serves under playlist_id instead.
  | { kind: "playlist"; playlistId: string }
  // A path under youtube.com whose page carries the canonical channel URL.
  | { kind: "path"; path: string };

// Accepts a channel ID, a playlist ID or link, an @handle, a bare handle, or
// any of the youtube.com URL forms; returns null for anything else. Returning the
// normalized parts rather than a boolean is deliberate — it's also what keeps
// a stray "../" out of a URL built from this.
export function parseChannelInput(raw: string): ChannelInput | null {
  let value = raw.trim();
  if (!value) return null;

  // A playlist link carries its id in ?list=, which has to be read before the
  // query string is discarded below — and a /watch?v=…&list=… URL is a
  // playlist link too, since that's what "share" gives you from inside one.
  const listParam = value.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (listParam && PLAYLIST_ID_RE.test(listParam[1])) {
    return { kind: "playlist", playlistId: listParam[1] };
  }

  // Strip a full URL down to its path, so a pasted address works as-is.
  const url = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(.+)$/i);
  if (url) value = url[1];
  // Drop any query string, fragment or trailing slash the paste carried along
  // (e.g. ".../@handle/videos?si=…").
  value = value.split(/[?#]/)[0].replace(/\/+$/, "");

  const channelPath = value.match(/^channel\/(UC[A-Za-z0-9_-]{22})$/);
  if (channelPath) return { kind: "id", channelId: channelPath[1] };
  if (CHANNEL_ID_RE.test(value)) return { kind: "id", channelId: value };
  if (PLAYLIST_ID_RE.test(value)) return { kind: "playlist", playlistId: value };
  if (LEGACY_RE.test(value)) return { kind: "path", path: value };

  // A handle, with or without the @ — someone typing the name they can see on
  // the channel page shouldn't have to know the @ matters.
  const handle = value.startsWith("@") ? value.slice(1) : value;
  // "…/@handle/videos" and similar keep only the handle itself.
  const [first] = handle.split("/");
  if (HANDLE_RE.test(first)) return { kind: "path", path: `@${first}` };

  return null;
}
