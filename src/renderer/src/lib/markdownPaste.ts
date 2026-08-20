// Pasting a URL over selected text turns it into a markdown link rather than
// replacing the text — the one editor nicety whose absence you notice every
// time. Everything else about paste is left to CodeMirror's default.
//
// Deliberately not doing HTML-to-markdown conversion on paste: it needs a
// whole conversion layer, and lossy round-trips are exactly the risk
// liveMarkdownPreview.ts's header already argues against for files that are
// also edited directly in Obsidian. Image paste is out for the same reason —
// it would need somewhere on disk to put the file.

import type { Extension } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { safeUrl } from "./urls";

// A single token with a scheme we're willing to link to. Requiring no
// internal whitespace is what keeps a paste of ordinary prose (which may well
// contain a URL somewhere inside it) behaving like a normal paste.
function pastedUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^mailto:/i.test(trimmed)) return null;
  return safeUrl(trimmed);
}

export function markdownPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const clipboard = event.clipboardData?.getData("text/plain");
      if (!clipboard) return false;

      const url = pastedUrl(clipboard);
      if (url === null) return false;
      // Nothing selected — a plain paste of the URL is what you want.
      if (view.state.selection.ranges.every((r) => r.empty)) return false;

      const { state } = view;
      const tr = state.changeByRange((range) => {
        if (range.empty) return { range };
        const label = state.sliceDoc(range.from, range.to);
        const insert = `[${label}](${url})`;
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        };
      });

      event.preventDefault();
      view.dispatch(state.update(tr, { scrollIntoView: true }));
      return true;
    },
  });
}
