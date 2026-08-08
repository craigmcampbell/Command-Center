// Obsidian/MultiMarkdown ==highlighted text== syntax as a @lezer/markdown
// InlineParser extension, using the same open/close delimiter machinery
// GFM's built-in Strikethrough (~~) extension uses (see @lezer/markdown's
// own Strikethrough source for the reference implementation this mirrors).
// Not part of CommonMark/GFM, so it has to be taught to the parser
// explicitly — same reasoning as wikilinkExtension.ts. Shared by both the
// live editor (markdownEditor.ts / liveMarkdownPreview.ts) and the static
// preview (markdown.ts), so they never disagree about what counts as
// highlighted text.

import type { MarkdownExtension, InlineContext } from "@lezer/markdown";
import { tags as t, Tag } from "@lezer/highlight";

// A dedicated tag (rather than reusing a built-in one) so the editor's
// HighlightStyle can give it its own background-color rule without
// affecting anything else.
export const highlightTag = Tag.define();

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

// Copied from @lezer/markdown's own (internal, unexported) Punctuation set —
// used to decide whether a "=" run sits next to punctuation, same left/right
// flanking rule CommonMark uses for `**`/`~~`.
const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1‐-‧]/;

function parseHighlight(cx: InlineContext, next: number, pos: number): number {
  if (next !== 61 /* '=' */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;

  const before = cx.slice(pos - 1, pos);
  const after = cx.slice(pos + 2, pos + 3);
  const sBefore = /\s|^$/.test(before);
  const sAfter = /\s|^$/.test(after);
  const pBefore = PUNCTUATION.test(before);
  const pAfter = PUNCTUATION.test(after);

  return cx.addDelimiter(
    HighlightDelim,
    pos,
    pos + 2,
    !sAfter && (!pAfter || sBefore || pBefore),
    !sBefore && (!pBefore || sAfter || pAfter)
  );
}

export const highlightExtension: MarkdownExtension = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      // After Emphasis/Strikethrough so "==" never gets misread while a `*`-
      // or `~`-delimited span is still being resolved around it.
      after: "Emphasis",
      parse: parseHighlight,
    },
  ],
};
