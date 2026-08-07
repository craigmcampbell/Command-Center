// "Live preview" (Obsidian/Typora-style) decorations for the markdown
// editor — the buffer stays plain markdown text (still what gets saved,
// still what gets hand-edited in Obsidian outside this app — see
// CLAUDE.md's Notes-tab note on no on-disk conflict detection), but marks
// like `**`/`_`/`==`/`# ` are hidden except on the line/range you're
// currently editing, headings get their real rendered size, and task
// checkboxes become actual clickable inputs. This is a ViewPlugin rather
// than a StateField because every decoration here is confined to a single
// line — no block widgets, no replacing ranges that span a line break — so
// the "must be provided directly, not via a view function" restriction on
// layout-affecting decorations doesn't apply (see EditorView.decorations'
// own doc comment).
//
// Deliberately does not try to be a full WYSIWYG rich-text editor (see the
// conversation this was built from) — hiding raw syntax when it's not
// being edited, à la Obsidian, rather than converting to/from a rich
// document model that risks lossy round-trips against files also edited
// directly in Obsidian.

import type { Extension, Range } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

function selectionOverlaps(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function cursorOnLine(state: EditorState, linePos: number): boolean {
  const line = state.doc.lineAt(linePos);
  return state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from);
}

// Task checkboxes stay real, clickable <input> elements at all times
// (unlike emphasis/heading marks, which only reveal their raw syntax while
// you're editing that line) — same reasoning DailyNoteWidget/Scratchpad's
// preview pane already use for interactive tasks, just live in the editor
// instead of only in the rendered-HTML preview.
class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-checkbox";
    box.checked = this.checked;
    box.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({
        changes: {
          from: this.from + 1,
          to: this.to - 1,
          insert: this.checked ? " " : "x",
        },
      });
    });
    return box;
  }
}

// Bullet markers are always re-styled (not reveal-on-cursor like emphasis/
// heading marks) — same reasoning as the task checkbox: it's a rendering
// choice, not raw syntax you'd ever want to see and edit directly, and
// always-on avoids the marker jumping between "-" and "•" as the cursor
// moves through the line.
class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-list-bullet";
    span.textContent = "•";
    return span;
  }
}

// Bold/italic/strikethrough/highlight all have the exact same shape — a
// node wrapping a pair of single- or double-char marks — so one function
// hides all of them, keyed off which child node type carries the mark.
function hideEmphasisMarks(
  state: EditorState,
  node: SyntaxNode,
  markType: string,
  hide: Range<Decoration>[]
): void {
  if (selectionOverlaps(state, node.from, node.to)) return;
  for (const mark of node.getChildren(markType)) {
    hide.push(Decoration.replace({}).range(mark.from, mark.to));
  }
}

function headingLevel(name: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const m = name.match(/^(?:ATX|Setext)Heading([1-6])$/);
  return m ? (Number(m[1]) as 1 | 2 | 3 | 4 | 5 | 6) : null;
}

const BLOCKQUOTE_MARK = /^(\s{0,3}(?:>\s?)+)/;

function buildDecorations(view: EditorView): { deco: DecorationSet; atomic: DecorationSet } {
  const { state } = view;
  const line: Range<Decoration>[] = [];
  const hide: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];

  // Multiple Decoration.line entries at the same line start are fine — CM
  // merges their classes when rendering — so a line touched twice (e.g. a
  // fenced code block's first line that's also inside a blockquote) just
  // adds a second decoration at the same point rather than needing to merge
  // class strings here.
  function addLineClass(pos: number, cls: string): void {
    const ln = state.doc.lineAt(pos);
    line.push(Decoration.line({ class: cls }).range(ln.from));
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(nodeRef) {
        const name = nodeRef.type.name;

        const level = headingLevel(name);
        if (level) {
          addLineClass(nodeRef.from, `cm-heading cm-heading-${level}`);
          if (name.startsWith("ATX") && !cursorOnLine(state, nodeRef.from)) {
            const node = nodeRef.node;
            const mark = node.getChild("HeaderMark");
            if (mark) {
              let end = mark.to;
              if (state.doc.sliceString(end, end + 1) === " ") end += 1;
              hide.push(Decoration.replace({}).range(mark.from, end));
              atomic.push(Decoration.replace({}).range(mark.from, end));
            }
          }
          return;
        }

        switch (name) {
          case "StrongEmphasis":
          case "Emphasis":
          case "Strikethrough":
            hideEmphasisMarks(state, nodeRef.node, "EmphasisMark", hide);
            hideEmphasisMarks(state, nodeRef.node, "StrikethroughMark", hide);
            break;
          case "Highlight":
            hideEmphasisMarks(state, nodeRef.node, "HighlightMark", hide);
            break;
          case "Blockquote": {
            const startLine = state.doc.lineAt(nodeRef.from).number;
            const endLine = state.doc.lineAt(Math.max(nodeRef.from, nodeRef.to - 1)).number;
            for (let n = startLine; n <= endLine; n++) {
              const ln = state.doc.line(n);
              addLineClass(ln.from, "cm-blockquote-line");
              if (cursorOnLine(state, ln.from)) continue;
              const m = ln.text.match(BLOCKQUOTE_MARK);
              if (m) hide.push(Decoration.replace({}).range(ln.from, ln.from + m[1].length));
            }
            break;
          }
          case "FencedCode": {
            const startLine = state.doc.lineAt(nodeRef.from).number;
            const endLine = state.doc.lineAt(Math.max(nodeRef.from, nodeRef.to - 1)).number;
            for (let n = startLine; n <= endLine; n++) {
              const ln = state.doc.line(n);
              const isFence = n === startLine || n === endLine;
              addLineClass(ln.from, isFence ? "cm-codeblock-line cm-codeblock-fence" : "cm-codeblock-line");
            }
            break;
          }
          case "Task": {
            const marker = nodeRef.node.getChild("TaskMarker");
            if (marker) {
              const checked = /\[[xX]\]/.test(state.doc.sliceString(marker.from, marker.to));
              const widget = Decoration.replace({
                widget: new TaskCheckboxWidget(checked, marker.from, marker.to),
              }).range(marker.from, marker.to);
              hide.push(widget);
              atomic.push(widget);
            }
            break;
          }
          // Task's own TaskMarker (handled above) covers the "[ ]"/"[x]" —
          // this handles the "-"/"*" that precedes it, plus plain (non-task)
          // bullets, since both are ListMark children of a BulletList's
          // ListItem. Ordered lists are left untouched: their numbers are
          // meaningful information, not decoration.
          case "BulletList": {
            for (const item of nodeRef.node.getChildren("ListItem")) {
              const mark = item.getChild("ListMark");
              if (!mark) continue;
              if (item.getChild("Task")) {
                let end = mark.to;
                if (state.doc.sliceString(end, end + 1) === " ") end += 1;
                const range = Decoration.replace({}).range(mark.from, end);
                hide.push(range);
                atomic.push(range);
              } else {
                hide.push(
                  Decoration.replace({ widget: new BulletWidget() }).range(mark.from, mark.to)
                );
              }
            }
            break;
          }
        }
      },
    });
  }

  return {
    deco: Decoration.set([...line, ...hide], true),
    atomic: Decoration.set(atomic, true),
  };
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomicRanges: DecorationSet;

    constructor(view: EditorView) {
      const built = buildDecorations(view);
      this.decorations = built.deco;
      this.atomicRanges = built.atomic;
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        const built = buildDecorations(update.view);
        this.decorations = built.deco;
        this.atomicRanges = built.atomic;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none),
  }
);

const livePreviewTheme = EditorView.theme({
  ".cm-heading": {
    fontWeight: "700",
  },
  ".cm-heading-1": { fontSize: "20px", color: "var(--ink)" },
  ".cm-heading-2": { fontSize: "17px", color: "var(--ink)" },
  ".cm-heading-3": { fontSize: "13px", color: "var(--accent)", letterSpacing: "0.02em" },
  ".cm-heading-4, .cm-heading-5, .cm-heading-6": {
    fontSize: "12px",
    color: "var(--ink-dim)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  ".cm-blockquote-line": {
    borderLeft: "3px solid var(--panel-edge)",
    paddingLeft: "9px",
    color: "var(--ink-dim)",
    fontStyle: "italic",
  },
  ".cm-codeblock-line": {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  ".cm-codeblock-fence": {
    color: "var(--ink-dim)",
  },
  ".cm-task-checkbox": {
    verticalAlign: "middle",
    marginRight: "6px",
    accentColor: "var(--accent)",
    cursor: "pointer",
  },
  ".cm-list-bullet": {
    color: "var(--ink-dim)",
  },
});

export function liveMarkdownPreview(): Extension {
  return [livePreviewPlugin, livePreviewTheme];
}
