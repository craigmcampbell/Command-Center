// What counts as a subreddit name, shared by the renderer (inline validation
// in the Settings form) and main (a guard before writing a row, and before
// building an API path out of it). Same reason shared/accelerator.ts exists:
// one definition, so the form can't accept something the write then rejects.
//
// Reddit names are 3–21 characters of word characters and can't start with an
// underscore — that prefix is reserved for the u_<name> profile form, which
// this widget doesn't handle.
const SUBREDDIT_RE = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

// Accepts the ways someone would actually type one — "rust", "r/rust",
// "/r/rust", or a pasted URL path with a trailing slash — and returns the bare
// name, or null if it isn't a usable subreddit name. Returning the normalized
// form rather than a boolean is deliberate: it's also what stops a "../" from
// ever reaching a /r/<name>/new URL.
export function normalizeSubreddit(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^https?:\/\/(?:www\.|old\.)?reddit\.com/i, "")
    .replace(/^\/?r\//i, "")
    .replace(/\/+$/, "");
  return SUBREDDIT_RE.test(name) ? name : null;
}
