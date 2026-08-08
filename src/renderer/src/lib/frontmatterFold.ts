// Collapsible YAML frontmatter (Obsidian-style "Properties") at the very
// start of a note. Built on @codemirror/language's fold mechanism rather
// than a hand-rolled hide-decoration — correctly folding an arbitrary
// multi-line range (placeholder widget, click-to-expand, leaving every other
// position in the document untouched) is exactly what that package already
// solves. This module only supplies "where's the foldable range" and a
// visible chevron to trigger it, since this editor has no line-number
// gutter to click (unlike @codemirror/language's own default foldGutter()).

import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { codeFolding, foldEffect, foldedRanges } from "@codemirror/language";
import { FRONTMATTER_DELIM, countFrontmatterProperties } from "./frontmatter";

interface FrontmatterRange {
  from: number; // end of the opening "---" line — fold starts here
  to: number; // end of the closing "---" line — fold ends here
  yaml: string;
}

// Re-derived from live doc state on every decoration rebuild rather than
// cached — cheap (bails after the first line for the overwhelming majority
// of notes, which don't open with "---" at all) and never goes stale as the
// user types, unlike a value stored once at editor creation.
function findFrontmatter(state: EditorState): FrontmatterRange | null {
  const first = state.doc.lineAt(0);
  if (!FRONTMATTER_DELIM.test(first.text)) return null;

  for (let n = first.number + 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (FRONTMATTER_DELIM.test(line.text)) {
      return { from: first.to, to: line.to, yaml: state.doc.sliceString(first.to + 1, line.from) };
    }
  }
  return null; // no closing delimiter — not a valid frontmatter block
}

function isFolded(state: EditorState, range: FrontmatterRange): boolean {
  let found = false;
  foldedRanges(state).between(range.from, range.to, () => {
    found = true;
  });
  return found;
}

// Only rendered while expanded (see buildDecorations) — collapsing is its
// one job, so it disappears the moment that happens. Deliberately NOT a
// two-way toggle: earlier this stayed visible in both states and flipped
// direction based on fold state, which put two independently-clickable
// "expand" controls (this widget and codeFolding's own placeholder) at
// nearly the same screen position once folded. A real mouse click is a
// mousedown+mouseup pair, and a second stray click landing back on that
// same spot — an accidental double-click, common enough on trackpads —
// would fold it and then immediately unfold it again, which looks
// indistinguishable from "collapsing did nothing." Making this widget
// disappear once folded means a second click there hits ordinary text
// instead of a live control, so only a deliberate click on the placeholder
// (which appears in a different spot, after the "---" text) expands it back.
class FrontmatterToggleWidget extends WidgetType {
  constructor(private readonly range: FrontmatterRange) {
    super();
  }

  eq(other: FrontmatterToggleWidget): boolean {
    return this.range.from === other.range.from && this.range.to === other.range.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("span");
    btn.className = "cm-frontmatter-toggle";
    btn.textContent = "▾";
    btn.title = "Collapse frontmatter";
    const { from, to } = this.range;
    btn.addEventListener("click", () => {
      view.dispatch({ effects: foldEffect.of({ from, to }) });
    });
    return btn;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const range = findFrontmatter(view.state);
  if (!range) return Decoration.none;
  if (isFolded(view.state, range)) return Decoration.none;

  // Dim the whole block (delimiters included) so it reads as distinct
  // chrome rather than note content — same idea as the blockquote/codeblock
  // line classes in liveMarkdownPreview.ts.
  const deco: Range<Decoration>[] = [
    Decoration.widget({ widget: new FrontmatterToggleWidget(range), side: -1 }).range(0),
  ];
  const endLine = view.state.doc.lineAt(range.to).number;
  for (let n = 1; n <= endLine; n++) {
    deco.push(Decoration.line({ class: "cm-frontmatter-line" }).range(view.state.doc.line(n).from));
  }

  return Decoration.set(deco, true);
}

const frontmatterTogglePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    // Rebuilt unconditionally: a fold/unfold toggle is an effect-only
    // transaction (no doc change, no selection change), so the narrower
    // docChanged/selectionSet/viewportChanged checks liveMarkdownPreview.ts
    // uses would miss exactly the update that needs to flip the chevron.
    // findFrontmatter() bails after one line for the common case (no
    // frontmatter at all), so this stays cheap.
    update(update: ViewUpdate): void {
      this.decorations = buildDecorations(update.view);
    }
  },
  { decorations: (v) => v.decorations }
);

function preparePlaceholder(state: EditorState): number {
  const range = findFrontmatter(state);
  return range ? countFrontmatterProperties(range.yaml) : 0;
}

const frontmatterFoldTheme = EditorView.theme({
  ".cm-frontmatter-toggle": {
    display: "inline-block",
    width: "14px",
    color: "var(--ink-dim)",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-frontmatter-toggle:hover": {
    color: "var(--accent)",
  },
  ".cm-frontmatter-line": {
    color: "var(--ink-dim)",
  },
  ".cm-foldPlaceholder": {
    background: "transparent",
    border: "1px solid var(--panel-edge)",
    borderRadius: "999px",
    padding: "0 8px",
    marginLeft: "6px",
    color: "var(--ink-dim)",
    fontFamily: "var(--mono)",
    fontSize: "11px",
    cursor: "pointer",
  },
  ".cm-foldPlaceholder:hover": {
    borderColor: "var(--accent)",
    color: "var(--accent)",
  },
});

// Called once, right after EditorState.create() and before the EditorView
// is constructed (see MarkdownEditor.tsx) — folding is a pure state
// transform (no view required), so this is the cheapest way to have a note
// open with its frontmatter already collapsed rather than dispatching a
// fold on the view a tick after first paint, which would show a flash of
// expanded content first.
export function foldFrontmatterByDefault(state: EditorState): EditorState {
  const range = findFrontmatter(state);
  if (!range) return state;
  return state.update({ effects: foldEffect.of({ from: range.from, to: range.to }) }).state;
}

export function frontmatterFold(): Extension {
  return [
    codeFolding({
      preparePlaceholder,
      placeholderDOM: (_view, onclick, prepared) => {
        const span = document.createElement("span");
        span.className = "cm-foldPlaceholder";
        const n = typeof prepared === "number" ? prepared : 0;
        span.textContent = n > 0 ? `${n} propert${n === 1 ? "y" : "ies"}` : "frontmatter";
        span.title = "Expand frontmatter";
        span.onclick = onclick;
        return span;
      },
    }),
    frontmatterTogglePlugin,
    frontmatterFoldTheme,
  ];
}
