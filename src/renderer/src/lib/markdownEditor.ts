// CodeMirror 6 setup for the Scratchpad's markdown editor — custom list/
// formatting commands, a highlight style matching the app's palette, and a
// theme that makes the editor fill and scroll correctly inside the existing
// split-pane layout. No React here; see components/MarkdownEditor.tsx for
// the lifecycle wiring.

import type { Extension } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  indentLess,
} from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, indentUnit } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";

// Only `-`/`*` bullets and tasks — deliberately matches exactly what
// lib/markdown.ts's preview renderer recognizes, so editor behavior and
// preview rendering never disagree about what counts as a list.
function matchListLine(
  text: string
): { indent: string; marker: string; isTask: boolean; markerEnd: number } | null {
  const taskMatch = text.match(/^(\s*)([-*])\s+\[[ xX]\]\s*/);
  if (taskMatch) {
    return { indent: taskMatch[1], marker: taskMatch[2], isTask: true, markerEnd: taskMatch[0].length };
  }
  const bulletMatch = text.match(/^(\s*)([-*])\s+/);
  if (bulletMatch) {
    return { indent: bulletMatch[1], marker: bulletMatch[2], isTask: false, markerEnd: bulletMatch[0].length };
  }
  return null;
}

function continueList(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) return false;

  const line = state.doc.lineAt(main.head);
  const info = matchListLine(line.text);
  if (!info || main.head < line.from + info.markerEnd) return false;

  const isEmptyItem = line.text.slice(info.markerEnd).trim() === "";
  if (isEmptyItem) {
    // Empty item — Enter exits the list instead of adding another one.
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: EditorSelection.cursor(line.from),
      scrollIntoView: true,
    });
    return true;
  }

  const insert = `\n${info.indent}${info.marker} ${info.isTask ? "[ ] " : ""}`;
  view.dispatch({
    changes: { from: main.head, insert },
    selection: EditorSelection.cursor(main.head + insert.length),
    scrollIntoView: true,
  });
  return true;
}

function wrapSelection(view: EditorView, wrapper: string): boolean {
  const { state } = view;
  const wLen = wrapper.length;
  const tr = state.changeByRange((range) => {
    if (range.empty) {
      const insert = wrapper + wrapper;
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.cursor(range.from + wLen),
      };
    }

    const selected = state.sliceDoc(range.from, range.to);

    // Selection itself includes the wrapper (e.g. user drag-selected past
    // the ** on both sides) — strip it from within the selection.
    if (selected.length >= wLen * 2 && selected.startsWith(wrapper) && selected.endsWith(wrapper)) {
      const inner = selected.slice(wLen, selected.length - wLen);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }

    // Selection is exactly the *inner* text with the wrapper sitting just
    // outside it on both sides — this is what wrapping leaves selected, so
    // a second press here is a toggle-off.
    const before = state.sliceDoc(Math.max(0, range.from - wLen), range.from);
    const after = state.sliceDoc(range.to, range.to + wLen);
    if (before === wrapper && after === wrapper) {
      return {
        changes: [
          { from: range.from - wLen, to: range.from, insert: "" },
          { from: range.to, to: range.to + wLen, insert: "" },
        ],
        range: EditorSelection.range(range.from - wLen, range.to - wLen),
      };
    }

    const insert = wrapper + selected + wrapper;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(range.from + wLen, range.to + wLen),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true }));
  return true;
}

const toggleBold = (view: EditorView): boolean => wrapSelection(view, "**");
const toggleItalic = (view: EditorView): boolean => wrapSelection(view, "_");

const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.4em", fontWeight: "700", color: "var(--accent)" },
  { tag: t.heading2, fontSize: "1.25em", fontWeight: "700", color: "var(--accent)" },
  { tag: t.heading3, fontSize: "1.12em", fontWeight: "600", color: "var(--accent)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600", color: "var(--accent)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--ink-dim)" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.monospace, fontFamily: "var(--mono)", color: "var(--live)" },
  { tag: t.quote, color: "var(--ink-dim)", fontStyle: "italic" },
  { tag: t.list, color: "var(--ink-dim)" },
  { tag: t.processingInstruction, color: "var(--ink-dim)" },
  { tag: t.contentSeparator, color: "var(--ink-dim)" },
]);

const markdownTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--ground)",
      color: "var(--ink)",
    },
    ".cm-content": {
      fontFamily: "var(--mono)",
      fontSize: "13px",
      lineHeight: "1.6",
      padding: "16px",
      caretColor: "var(--accent)",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-selectionBackground": {
      backgroundColor: "var(--accent-glow)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--accent)",
    },
    ".cm-placeholder": {
      color: "var(--ink-dim)",
      fontFamily: "var(--mono)",
    },
  },
  { dark: true }
);

export function buildMarkdownEditorExtensions(
  onDocChanged: (text: string) => void,
  placeholderText?: string
): Extension[] {
  return [
    history(),
    indentUnit.of("  "),
    keymap.of([
      { key: "Tab", run: indentMore, shift: indentLess },
      { key: "Enter", run: continueList },
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    // addKeymap: false — @codemirror/lang-markdown otherwise installs its
    // own Prec.high Enter/Backspace bindings (insertNewlineContinueMarkup /
    // deleteMarkupBackward) that would shadow our own Enter binding above
    // (normal-precedence bindings never get a chance to run if a
    // higher-precedence one matches the same key first).
    markdown({ addKeymap: false }),
    syntaxHighlighting(markdownHighlightStyle),
    markdownTheme,
    EditorView.lineWrapping,
    placeholder(placeholderText ?? ""),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onDocChanged(update.state.doc.toString());
    }),
  ];
}
