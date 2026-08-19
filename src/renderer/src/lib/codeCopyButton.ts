// A "copy" button pinned to the top-right of each fenced code block in the
// live editor, mirroring lib/markdown.ts's Preview-mode button. Implemented
// as a StateField (not a ViewPlugin like liveMarkdownPreview.ts) because it
// needs *block* widgets — a zero-height wrapper inserted before the fence so
// the button can escape it via absolute positioning without pushing the code
// lines down — and EditorView.decorations only allows block widgets from
// decoration sets "provided directly", not from the view-dependent function
// form a ViewPlugin's `decorations` field uses (see that facet's own doc
// comment). A StateField's value satisfies "provided directly".
//
// Dim-but-always-present, brightening on hover, rather than hidden-until-
// hover: a `pointer-events: none` default revealed only via a
// `:has(+ .cm-codeblock-fence:hover)` sibling-hover rule looked right in
// isolation but didn't reliably survive from a plain mousemove to a
// following click in testing — the click landed on the editor text
// underneath instead of the button. Always-interactive sidesteps that
// failure mode entirely; see markdown.ts's Preview button (a real DOM `<pre>`
// wrapping the whole block) for the hidden-until-hover version, which has no
// such timing dependency.

import type { Extension, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

// Same path data as components/icons.tsx's IconCopy/IconCheck — duplicated
// because this renders into a WidgetType's plain-DOM toDOM(), not React; kept
// in sync by hand, same as lib/markdown.ts's COPY_BUTTON_ICONS.
const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6"></path></svg>';

class CodeCopyButtonWidget extends WidgetType {
  constructor(private readonly code: string) {
    super();
  }

  eq(other: CodeCopyButtonWidget): boolean {
    return this.code === other.code;
  }

  // Hints to CodeMirror's layout pass that this block consumes no vertical
  // space — it's a positioning anchor, not real content.
  get estimatedHeight(): number {
    return 0;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-code-copy-wrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-code-copy-btn";
    btn.title = "Copy code";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = COPY_ICON;
    // stopPropagation (not preventDefault) — this keeps the browser's normal
    // click-to-focus behavior, which the clipboard write below depends on
    // (navigator.clipboard.writeText rejects with "Document is not focused"
    // otherwise), while still stopping the mousedown from bubbling up into
    // CodeMirror's own mousedown handling, which would otherwise interpret it
    // as a click-to-position-cursor gesture on the editor content beneath.
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.code).then(() => {
        btn.innerHTML = CHECK_ICON;
        btn.classList.add("cm-code-copy-btn-done");
        window.setTimeout(() => {
          btn.innerHTML = COPY_ICON;
          btn.classList.remove("cm-code-copy-btn-done");
        }, 1200);
      });
    });

    wrap.appendChild(btn);
    return wrap;
  }
}

function buildCopyButtonDecorations(state: EditorState): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(nodeRef) {
      if (nodeRef.type.name !== "FencedCode") return;
      const codeText = nodeRef.node.getChild("CodeText");
      const code = codeText ? state.doc.sliceString(codeText.from, codeText.to) : "";
      widgets.push(
        Decoration.widget({ widget: new CodeCopyButtonWidget(code), block: true, side: -1 }).range(
          nodeRef.from
        )
      );
    },
  });
  return Decoration.set(widgets, true);
}

const copyButtonField = StateField.define<DecorationSet>({
  create: buildCopyButtonDecorations,
  update(deco, tr) {
    return tr.docChanged ? buildCopyButtonDecorations(tr.state) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const copyButtonTheme = EditorView.theme({
  ".cm-code-copy-wrap": {
    position: "relative",
    height: "0",
  },
  ".cm-code-copy-btn": {
    position: "absolute",
    top: "4px",
    right: "8px",
    zIndex: "2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    padding: "0",
    border: "1px solid var(--panel-edge)",
    borderRadius: "4px",
    background: "var(--panel)",
    color: "var(--ink-dim)",
    cursor: "pointer",
    // Dim-but-present rather than fully hidden-until-hover: a pointer-events:
    // none default (revealed only via a `:has(+ .cm-codeblock-fence:hover)`
    // sibling-hover rule) tested unreliable here — CSS hover state didn't
    // reliably survive from a mousemove to a following click in this
    // environment, so the click passed through to the text underneath.
    // Always-interactive avoids that failure mode entirely.
    opacity: "0.45",
    pointerEvents: "auto",
    transition: "opacity 0.15s ease",
  },
  ".cm-code-copy-btn:hover, .cm-code-copy-btn:focus-visible": {
    opacity: "1",
    color: "var(--ink)",
    borderColor: "var(--accent)",
  },
  ".cm-code-copy-btn-done": {
    color: "var(--accent)",
    borderColor: "var(--accent)",
  },
});

export function codeFenceCopyButton(): Extension {
  return [copyButtonField, copyButtonTheme];
}
