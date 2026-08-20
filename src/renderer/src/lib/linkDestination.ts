// Where a link-ish syntax-tree node points, resolved one way for everybody.
//
// Shared by lib/clickableLinks.ts (what Mod+click actually opens) and
// lib/liveMarkdownPreview.ts (what gets the "this is followable" underline
// and hover tooltip), so the thing that *looks* clickable and the thing that
// *is* clickable can't drift apart — same reasoning as codeLanguages.ts and
// matchListLine being shared between the editor and the preview renderer.
//
// The node shapes here are what @lezer/markdown + GFM actually emit:
//   [label](url)          → Link      > URL
//   ![alt](url)           → Image     > URL
//   <https://x.com>       → Autolink  > URL
//   https://x.com         → URL       (bare, no wrapper node at all)
//   www.x.com / a@b.com   → URL       (bare, and with no scheme)
//   [[Target]]            → WikiLink  > WikiLinkTarget
// The bare-URL case is why this exists: clickableLinks.ts used to match only
// Link/Image/WikiLink/WikiEmbed, so a plain pasted URL — the single most
// common kind of link in a note — was unfollowable in the editor.

import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { normalizeBareUrl, safeUrl } from "./urls";

export interface LinkDestination {
  // "url" targets open via window.api.openUrl; "wikilink" targets need a
  // vault to resolve against, so only NotesWidget can follow them.
  kind: "url" | "wikilink";
  // For "url", already normalized and checked by safeUrl — safe to open.
  target: string;
}

function urlDestination(raw: string): LinkDestination | null {
  const safe = safeUrl(raw);
  return safe === null ? null : { kind: "url", target: safe };
}

export function linkDestination(state: EditorState, node: SyntaxNode): LinkDestination | null {
  const name = node.type.name;
  switch (name) {
    case "Link":
    case "Image":
    case "Autolink": {
      const url = node.getChild("URL");
      if (!url) return null;
      return urlDestination(state.doc.sliceString(url.from, url.to).trim());
    }
    case "URL": {
      // A URL nested inside one of the above is that node's business —
      // returning null here lets the caller keep walking up to the wrapper,
      // and stops a relative href being wrongly normalized to https://.
      const parent = node.parent?.type.name;
      if (parent === "Link" || parent === "Image" || parent === "Autolink") return null;
      return urlDestination(normalizeBareUrl(state.doc.sliceString(node.from, node.to).trim()));
    }
    case "WikiLink":
    case "WikiEmbed": {
      const target = node.getChild("WikiLinkTarget");
      if (!target) return null;
      const text = state.doc.sliceString(target.from, target.to).trim();
      return text ? { kind: "wikilink", target: text } : null;
    }
    default:
      return null;
  }
}
