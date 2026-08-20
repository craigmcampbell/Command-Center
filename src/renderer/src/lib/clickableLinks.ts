// Mod+click (Cmd on macOS, Ctrl elsewhere) to open a link from inside the
// live-preview editor — a plain click still just places the cursor there
// (revealing the raw syntax, per liveMarkdownPreview.ts's mark-hiding), same
// convention Obsidian uses so clicking into a collapsed link to fix a typo
// and clicking to follow it stay unambiguous, distinct actions.
//
// Which nodes count as links, and where each one points, lives in
// lib/linkDestination.ts — shared with liveMarkdownPreview.ts so the
// underline it draws on Mod-hover marks exactly the things this will open.
//
// Regular URLs always resolve the same way (window.api.openUrl) regardless
// of which widget hosts the editor, so that half needs no configuration.
// Wikilinks need vault-specific resolution (only NotesWidget has one), so
// that half is opt-in via onOpenWikilink — omitted, a wikilink click just
// falls through to normal cursor placement, consistent with wikilinks
// rendering inert in Scratchpad/DailyNote's own preview pane for the same
// no-vault-context reason (see lib/markdown.ts).

import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { linkDestination } from "./linkDestination";
import type { LinkDestination } from "./linkDestination";

export interface ClickableLinksOptions {
  onOpenWikilink?: (target: string) => void;
}

// Walks up from the innermost node at `pos` looking for something
// followable. Walking up (rather than the old zero-width tree iterate)
// matters at node boundaries: clicking the last character of a collapsed
// link resolves to the text node, whose parent is the Link.
export function destinationAt(view: EditorView, pos: number): LinkDestination | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, -1);
  while (node) {
    const dest = linkDestination(view.state, node);
    if (dest) return dest;
    node = node.parent;
  }
  return null;
}

// Adds a class to the editor while Cmd/Ctrl is held, so the theme can turn
// link ranges into something that visibly reads as clickable. Without this
// the gesture is invisible: nothing about a live-preview link suggests it
// can be followed at all, which is what made the rendered Preview pane feel
// mandatory rather than optional.
const modHeldTracker = ViewPlugin.fromClass(
  class {
    private readonly onKey: (event: KeyboardEvent) => void;
    private readonly onBlur: () => void;

    constructor(private readonly view: EditorView) {
      this.onKey = (event) => this.set(event.metaKey || event.ctrlKey);
      // Cmd+Tab away with the key still down would otherwise leave the
      // editor stuck in its "links are clickable" state until the next
      // keypress, since no keyup ever arrives.
      this.onBlur = () => this.set(false);
      window.addEventListener("keydown", this.onKey);
      window.addEventListener("keyup", this.onKey);
      window.addEventListener("blur", this.onBlur);
    }

    private set(held: boolean): void {
      this.view.contentDOM.classList.toggle("cm-mod-held", held);
    }

    destroy(): void {
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("keyup", this.onKey);
      window.removeEventListener("blur", this.onBlur);
    }
  }
);

export function clickableLinks(options: ClickableLinksOptions = {}): Extension {
  return [
    modHeldTracker,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;

        const dest = destinationAt(view, pos);
        if (!dest) return false;

        if (dest.kind === "url") {
          void window.api.openUrl(dest.target);
        } else {
          if (!options.onOpenWikilink) return false;
          options.onOpenWikilink(dest.target);
        }

        event.preventDefault();
        return true;
      },
    }),
  ];
}
