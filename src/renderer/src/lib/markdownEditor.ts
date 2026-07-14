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
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import { buildEditorCodeLanguageDescriptions } from "./codeLanguages";
import { wikilinkExtension } from "./wikilinkExtension";

// Bullets, ordered markers, and tasks — deliberately matches exactly what
// lib/markdown.ts's preview renderer recognizes, so editor behavior and
// preview rendering never disagree about what counts as a list. `nextMarker`
// is what continueList inserts on the following line — unchanged for
// bullets, auto-incremented for ordered lists.
interface ListLineInfo {
  indent: string;
  isTask: boolean;
  markerEnd: number;
  nextMarker: string;
}

function matchListLine(text: string): ListLineInfo | null {
  const bulletTask = text.match(/^(\s*)([-*])\s+\[[ xX]\]\s*/);
  if (bulletTask) {
    return { indent: bulletTask[1], isTask: true, markerEnd: bulletTask[0].length, nextMarker: bulletTask[2] };
  }
  const bullet = text.match(/^(\s*)([-*])\s+/);
  if (bullet) {
    return { indent: bullet[1], isTask: false, markerEnd: bullet[0].length, nextMarker: bullet[2] };
  }
  const orderedTask = text.match(/^(\s*)(\d+)([.)])\s+\[[ xX]\]\s*/);
  if (orderedTask) {
    const next = Number(orderedTask[2]) + 1;
    return {
      indent: orderedTask[1],
      isTask: true,
      markerEnd: orderedTask[0].length,
      nextMarker: `${next}${orderedTask[3]}`,
    };
  }
  const ordered = text.match(/^(\s*)(\d+)([.)])\s+/);
  if (ordered) {
    const next = Number(ordered[2]) + 1;
    return {
      indent: ordered[1],
      isTask: false,
      markerEnd: ordered[0].length,
      nextMarker: `${next}${ordered[3]}`,
    };
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

  const insert = `\n${info.indent}${info.nextMarker} ${info.isTask ? "[ ] " : ""}`;
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
const toggleStrikethrough = (view: EditorView): boolean => wrapSelection(view, "~~");

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
  // Generic code tokens — only exercised inside fenced code blocks, once
  // codeLanguages (see buildMarkdownEditorExtensions) hands that region off
  // to a nested language's own parser. Mirrors the .tok-* CSS classes
  // lib/codeHighlight.ts's classHighlighter produces for the static preview,
  // so a fence looks the same whether you're editing or previewing it.
  { tag: [t.keyword, t.atom, t.bool], color: "var(--accent)" },
  { tag: [t.string, t.special(t.string), t.inserted], color: "var(--live)" },
  { tag: [t.comment, t.meta], color: "var(--ink-dim)", fontStyle: "italic" },
  { tag: [t.number, t.literal], color: "var(--pending)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--alert)" },
  { tag: [t.propertyName, t.labelName], color: "var(--accent)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--ink)" },
  { tag: [t.operator, t.punctuation], color: "var(--ink-dim)" },
  { tag: t.invalid, color: "var(--alert)" },
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
      { key: "Mod-Shift-x", run: toggleStrikethrough },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    // addKeymap: false — @codemirror/lang-markdown otherwise installs its
    // own Prec.high Enter/Backspace bindings (insertNewlineContinueMarkup /
    // deleteMarkupBackward) that would shadow our own Enter binding above
    // (normal-precedence bindings never get a chance to run if a
    // higher-precedence one matches the same key first).
    // base: markdownLanguage — GFM (tables/strikethrough/tasklists/
    // autolinks) instead of the default bare-CommonMark commonmarkLanguage,
    // matching lib/markdown.ts's preview parser so the editor's syntax
    // highlighting and the preview agree on what's a table/strikethrough/etc.
    // codeLanguages — the same curated set lib/codeHighlight.ts uses for the
    // static preview, so fenced code blocks get real syntax coloring live in
    // the editor too, not just in preview.
    // extensions: wikilinkExtension — the same [[Target]]/![[Target]] grammar
    // lib/markdown.ts's preview uses, so the editor highlights wikilinks too.
    markdown({
      addKeymap: false,
      base: markdownLanguage,
      codeLanguages: buildEditorCodeLanguageDescriptions(),
      extensions: [wikilinkExtension],
    }),
    syntaxHighlighting(markdownHighlightStyle),
    markdownTheme,
    EditorView.lineWrapping,
    placeholder(placeholderText ?? ""),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onDocChanged(update.state.doc.toString());
    }),
  ];
}
