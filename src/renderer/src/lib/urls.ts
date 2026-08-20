// URL handling shared by the static preview renderer (lib/markdown.ts) and
// the editor's link following (lib/linkDestination.ts). Lives in its own
// module rather than in markdown.ts because linkDestination.ts needs it too,
// and markdown.ts already imports enough that the two would form a cycle.

// Schemes safe to emit as an href/src. http(s) and mailto are obvious;
// obsidian: is deliberate (services/grimoire.ts already builds obsidian://
// URIs this app opens via shell.openExternal) and so is file: — vault notes
// legitimately link to local files, the same trust level as the File Links
// widget, which shells `open -a ForkLift <path>` on user-supplied paths.
const SAFE_SCHEMES = /^(?:https?|mailto|obsidian|file):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// Returns the URL if it's safe to put in an href/src (or hand to
// window.api.openUrl), or null if the caller should render inert text.
//
// Escaping alone isn't enough here: escapeAttr stops you breaking *out* of
// the attribute, but "javascript:alert(1)" needs no quotes to be dangerous.
// Links are also mitigated downstream (markdownPreviewInteractions.ts calls
// preventDefault on every a[href] and routes through window.api.openUrl),
// but <img src> never passes through a click handler at all — that's the
// case with no mitigation otherwise.
//
// test cases: "javascript:alert(1)" and "JaVaScRiPt:alert(1)" → null;
// "java\nscript:alert(1)" and "java\tscript:alert(1)" → null (see below);
// "data:text/html,<script>" → null; "vbscript:msgbox" → null;
// "https://x.com" / "mailto:a@b.c" / "./img.png" / "#anchor" / "" → allowed.
export function safeUrl(raw: string): string | null {
  // Strip C0 controls and spaces before testing the scheme. This is the
  // actual bypass and the whole reason this isn't a one-line regex: browsers
  // strip \t, \n and \r while parsing a URL, so "java\nscript:alert(1)" is a
  // live javascript: URL to Chromium but sails straight past /^javascript:/.
  // Test the stripped form; emit the original, which the browser will
  // normalize the same way.
  const probe = raw.replace(/[\u0000-\u0020]/g, "");
  // No scheme at all means relative ("./img.png", "notes/x.md", "#anchor") —
  // always fine, and the common case inside a vault.
  if (!HAS_SCHEME.test(probe)) return raw;
  return SAFE_SCHEMES.test(probe) ? raw : null;
}

// GFM linkifies things that aren't usable URLs on their own: "www.x.com" has
// no scheme (shell.openExternal would reject it) and a bare email needs
// mailto:. Only ever applied to standalone URL nodes — inside [x](./rel.md) a
// scheme-less target is a legitimate relative path and must stay as it is.
export function normalizeBareUrl(raw: string): string {
  if (HAS_SCHEME.test(raw)) return raw;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return `mailto:${raw}`;
  return `https://${raw}`;
}
