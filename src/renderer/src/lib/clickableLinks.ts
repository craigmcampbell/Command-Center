// Mod+click (Cmd on macOS, Ctrl elsewhere) to open a link from inside the
// live-preview editor — a plain click still just places the cursor there
// (revealing the raw syntax, per liveMarkdownPreview.ts's mark-hiding), same
// convention Obsidian uses so clicking into a collapsed link to fix a typo
// and clicking to follow it stay unambiguous, distinct actions.
//
// Regular [text](url)/![alt](url) links always resolve the same way
// (window.api.openUrl) regardless of which widget hosts the editor, so that
// half needs no configuration. Wikilinks need vault-specific resolution
// (only NotesWidget has one), so that half is opt-in via onOpenWikilink —
// omitted, a wikilink click just falls through to normal cursor placement,
// consistent with wikilinks rendering inert in Scratchpad/DailyNote's own
// preview pane for the same no-vault-context reason (see lib/markdown.ts).

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

export interface ClickableLinksOptions {
  onOpenWikilink?: (target: string) => void;
}

export function clickableLinks(options: ClickableLinksOptions = {}): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      let handled = false;
      syntaxTree(view.state).iterate({
        from: pos,
        to: pos,
        enter(nodeRef) {
          if (handled) return false;
          const name = nodeRef.type.name;

          if (name === "Link" || name === "Image") {
            const urlNode = nodeRef.node.getChild("URL");
            if (urlNode) {
              const url = view.state.doc.sliceString(urlNode.from, urlNode.to);
              void window.api.openUrl(url);
              handled = true;
            }
          } else if (name === "WikiLink" || name === "WikiEmbed") {
            const targetNode = nodeRef.node.getChild("WikiLinkTarget");
            if (targetNode && options.onOpenWikilink) {
              const target = view.state.doc.sliceString(targetNode.from, targetNode.to).trim();
              options.onOpenWikilink(target);
              handled = true;
            }
          }
          return !handled;
        },
      });

      if (handled) event.preventDefault();
      return handled;
    },
  });
}
