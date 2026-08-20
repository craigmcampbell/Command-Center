// Find/replace for the markdown editor (Mod-F). Pairs @codemirror/search's
// panel with a theme matching the app's palette, in its own module for the
// same reason codeCopyButton.ts and frontmatterFold.ts are — each editor
// feature owns its plugin plus its styling, rather than growing
// markdownEditor.ts further.

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { search } from "@codemirror/search";

// The panel is CodeMirror's own DOM, so it's themed here rather than in
// styles.css (see the comment on .scratchpad-editor there). markdownTheme
// already passes { dark: true }, which gets CodeMirror's dark base styles —
// but those are generic greys, not this app's colors, so the overrides below
// are still needed.
const searchPanelTheme = EditorView.theme({
  ".cm-panels": {
    background: "var(--ground)",
    color: "var(--ink)",
    borderBottom: "1px solid var(--panel-edge)",
  },
  ".cm-panel.cm-search": {
    padding: "6px 8px",
    fontFamily: "var(--mono)",
    fontSize: "11px",
  },
  ".cm-panel.cm-search label": {
    color: "var(--ink-dim)",
    fontSize: "11px",
  },
  ".cm-textfield": {
    background: "transparent",
    border: "1px solid var(--panel-edge)",
    borderRadius: "4px",
    color: "var(--ink)",
    fontFamily: "var(--mono)",
    fontSize: "11px",
    padding: "3px 6px",
  },
  ".cm-textfield:focus": {
    outline: "none",
    borderColor: "var(--accent)",
  },
  ".cm-button": {
    background: "transparent",
    backgroundImage: "none",
    border: "1px solid var(--panel-edge)",
    borderRadius: "999px",
    color: "var(--ink-dim)",
    fontFamily: "var(--mono)",
    fontSize: "11px",
    padding: "3px 10px",
    cursor: "pointer",
  },
  ".cm-button:hover": {
    borderColor: "var(--accent)",
    color: "var(--accent)",
  },
  ".cm-panel.cm-search [name=close]": {
    color: "var(--ink-dim)",
    fontSize: "14px",
    cursor: "pointer",
  },
  ".cm-panel.cm-search [name=close]:hover": {
    color: "var(--alert)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--pending-glow)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--accent-glow)",
    outline: "1px solid var(--accent)",
  },
});

export function markdownSearch(): Extension {
  // top: true matters here. The editor lives in a fixed-height flex pane
  // with `.cm-scroller { overflow: auto }`, so a bottom panel ends up below
  // the scroller and reads as detached from the editor.
  return [search({ top: true }), searchPanelTheme];
}
