// Obsidian's [[Target]] / [[Target|Alias]] / ![[Target]] syntax as a
// @lezer/markdown InlineParser extension — not part of CommonMark/GFM, so it
// has to be taught to the parser explicitly. Shared by both the live editor
// (markdownEditor.ts) and the static preview (markdown.ts), so they can
// never disagree about what counts as a wikilink, same reasoning as the
// GFM/heading work elsewhere in this file set.
//
// Resolving a target to an actual vault file (and rendering it as clickable
// vs. broken) is the renderer's job, not this parser's — see markdown.ts's
// WikiLink/WikiEmbed handling. This only recognizes the syntax and captures
// the target/alias spans.

import type { MarkdownExtension, InlineContext } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";

function parseWikilink(cx: InlineContext, next: number, pos: number): number {
  const start = pos;
  let embed = false;

  if (next === 33 /* ! */) {
    if (cx.char(pos + 1) !== 91 || cx.char(pos + 2) !== 91) return -1;
    embed = true;
    pos += 3;
  } else if (next === 91 /* [ */) {
    if (cx.char(pos + 1) !== 91) return -1;
    pos += 2;
  } else {
    return -1;
  }

  const closeIdx = cx.text.indexOf("]]", pos - cx.offset);
  if (closeIdx < 0) return -1;
  const end = closeIdx + cx.offset;
  if (end === pos) return -1; // "[[]]" — nothing between the brackets

  const raw = cx.slice(pos, end);
  const pipeIdx = raw.indexOf("|");
  const targetEnd = pipeIdx >= 0 ? pos + pipeIdx : end;
  const target = cx.slice(pos, targetEnd).trim();
  if (!target) return -1;

  const children = [cx.elt("WikiLinkTarget", pos, targetEnd)];
  if (pipeIdx >= 0) children.push(cx.elt("WikiLinkAlias", pos + pipeIdx + 1, end));

  return cx.addElement(cx.elt(embed ? "WikiEmbed" : "WikiLink", start, end + 2, children));
}

export const wikilinkExtension: MarkdownExtension = {
  defineNodes: [
    { name: "WikiLink", style: t.link },
    { name: "WikiEmbed", style: t.link },
    { name: "WikiLinkTarget", style: t.labelName },
    { name: "WikiLinkAlias", style: t.labelName },
  ],
  parseInline: [
    {
      name: "WikiLink",
      // Before Link/Image so plain [text](url) and ![alt](url) are never
      // intercepted — this only fires on the double-bracket form.
      before: "Link",
      parse: parseWikilink,
    },
  ],
};
