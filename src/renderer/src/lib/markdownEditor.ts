// CodeMirror 6 setup for the Scratchpad's markdown editor — custom list/
// formatting commands, a highlight style matching the app's palette, and a
// theme that makes the editor fill and scroll correctly inside the existing
// split-pane layout. No React here; see components/MarkdownEditor.tsx for
// the lifecycle wiring.

import type { Extension } from "@codemirror/state";
import { Annotation, Compartment, EditorSelection } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import type { Command } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  indentLess,
} from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting, indentUnit } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import { buildEditorCodeLanguageDescriptions } from "./codeLanguages";
import { wikilinkExtension } from "./wikilinkExtension";
import { highlightExtension, highlightTag } from "./highlightExtension";
import { liveMarkdownPreview } from "./liveMarkdownPreview";
import { codeFenceCopyButton } from "./codeCopyButton";
import { frontmatterFold } from "./frontmatterFold";
import { clickableLinks } from "./clickableLinks";
import { markdownPaste } from "./markdownPaste";
import { markdownSearch } from "./editorSearch";

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

export const toggleBold: Command = (view) => wrapSelection(view, "**");
export const toggleItalic: Command = (view) => wrapSelection(view, "_");
export const toggleStrikethrough: Command = (view) => wrapSelection(view, "~~");
export const toggleInlineCode: Command = (view) => wrapSelection(view, "`");

// ---- line-prefix commands (headings, quotes, lists) ----

interface LineChange {
  from: number;
  to: number;
  insert: string;
}

// Applies an edit to every line any selection range touches, as ONE
// transaction. Deliberately not state.changeByRange: that maps one change
// per *range*, and a single range spanning five lines needs five changes.
// Returning null from `edit` skips that line (blank lines, mostly).
function editSelectedLines(
  view: EditorView,
  edit: (text: string, lineFrom: number) => LineChange | null
): boolean {
  const { state } = view;
  const seen = new Set<number>();
  const changes: LineChange[] = [];

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const change = edit(line.text, line.from);
      if (change) changes.push(change);
    }
  }

  if (changes.length === 0) return false;
  changes.sort((a, b) => a.from - b.from);
  view.dispatch(state.update({ changes, scrollIntoView: true }));
  return true;
}

function leadingIndent(text: string): string {
  return /^\s*/.exec(text)![0];
}

const ATX_PREFIX = /^(\s*)(#{1,6})(\s+)/;
const QUOTE_PREFIX = /^(\s*)(>\s?)/;

// level 0 strips any heading. Re-applying the level you're already at also
// strips it, so the toolbar's H1/H2/H3 buttons toggle rather than only ever
// adding.
export function setHeadingLevel(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): Command {
  return (view) =>
    editSelectedLines(view, (text, from) => {
      const indent = leadingIndent(text);
      const existing = ATX_PREFIX.exec(text);
      if (existing) {
        const same = existing[2].length === level;
        return {
          from: from + indent.length,
          to: from + existing[0].length,
          insert: same || level === 0 ? "" : `${"#".repeat(level)} `,
        };
      }
      if (level === 0 || text.trim() === "") return null;
      return { from: from + indent.length, to: from + indent.length, insert: `${"#".repeat(level)} ` };
    });
}

export const toggleBlockquote: Command = (view) =>
  editSelectedLines(view, (text, from) => {
    const indent = leadingIndent(text);
    const existing = QUOTE_PREFIX.exec(text);
    if (existing) {
      return { from: from + indent.length, to: from + existing[0].length, insert: "" };
    }
    return { from: from + indent.length, to: from + indent.length, insert: "> " };
  });

// All three list toggles read the existing marker through matchListLine
// rather than their own regexes — that function is the single definition of
// what this app considers a list, shared with continueList above and kept
// deliberately in step with lib/markdown.ts's preview renderer.
function replaceListMarker(
  text: string,
  lineFrom: number,
  marker: string | null,
  isAlreadyThisKind: (info: ListLineInfo) => boolean
): LineChange | null {
  if (text.trim() === "") return null;
  const indent = leadingIndent(text);
  const info = matchListLine(text);
  // Same kind again = toggle off: drop the marker, keep the content.
  if (info && isAlreadyThisKind(info)) {
    return { from: lineFrom + indent.length, to: lineFrom + info.markerEnd, insert: "" };
  }
  if (marker === null) return null;
  // Converting between kinds replaces the old marker; a plain line just
  // gains one.
  return {
    from: lineFrom + indent.length,
    to: lineFrom + (info ? info.markerEnd : indent.length),
    insert: marker,
  };
}

const isBullet = (info: ListLineInfo): boolean => /^[-*]$/.test(info.nextMarker);
const isOrdered = (info: ListLineInfo): boolean => /^\d+[.)]$/.test(info.nextMarker);

export const toggleBulletList: Command = (view) =>
  editSelectedLines(view, (text, from) =>
    replaceListMarker(text, from, "- ", (info) => isBullet(info) && !info.isTask)
  );

export const toggleOrderedList: Command = (view) => {
  // Numbering restarts at 1 per invocation and counts only the lines that
  // actually get a marker, so selecting five lines gives 1..5 rather than
  // five 1.s.
  let n = 0;
  return editSelectedLines(view, (text, from) => {
    const alreadyOrdered = (info: ListLineInfo): boolean => isOrdered(info) && !info.isTask;
    const existing = matchListLine(text);
    if (text.trim() !== "" && !(existing && alreadyOrdered(existing))) n += 1;
    return replaceListMarker(text, from, `${n}. `, alreadyOrdered);
  });
};

export const toggleTaskList: Command = (view) =>
  editSelectedLines(view, (text, from) =>
    replaceListMarker(text, from, "- [ ] ", (info) => info.isTask)
  );

// ---- insertions ----

export const insertLink: Command = (view) => {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const insert = `[${selected}]()`;
    // Cursor lands inside the parens, ready for the URL — the part you
    // always have to type, whether or not there was a selection to wrap.
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + selected.length + 3),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true }));
  return true;
};

// Block-level inserts go on their own line: appended after the current line
// if it has content, in place if it's blank. `cursorOffset` is measured from
// the start of `block`.
function insertBlock(view: EditorView, block: string, cursorOffset: number): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.from);
  const needsBreak = line.text.trim() !== "";
  const at = needsBreak ? line.to : line.from;
  const insert = needsBreak ? `\n${block}` : block;
  view.dispatch({
    changes: { from: at, to: at, insert },
    selection: EditorSelection.cursor(at + (needsBreak ? 1 : 0) + cursorOffset),
    scrollIntoView: true,
  });
  return true;
}

// Cursor lands on the language slot right after the opening fence, which is
// where lib/codeLanguages.ts's highlighting reads from.
export const insertCodeFence: Command = (view) => insertBlock(view, "```\n\n```", 3);

export const insertTable: Command = (view) =>
  insertBlock(view, "| Column | Column |\n| --- | --- |\n|  |  |", 2);

const markdownHighlightStyle = HighlightStyle.define([
  // Heading size/weight/color is handled per-line by liveMarkdownPreview's
  // cm-heading-N classes instead (exact parity with lib/markdown.ts's .note
  // h1-h6 preview sizes) — a tag-based rule here would stack with that
  // line-level font-size rather than replace it.
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--ink-dim)" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  // @lezer/markdown tags a link's URL segment as t.url specifically (not
  // t.link) — and @lezer/highlight defines t.url as a sub-tag of t.literal,
  // so without an explicit rule here it falls through to the generic
  // number/literal color below instead of matching the link rule above,
  // making "[text](url)" render as two different colors. Same style as
  // t.link so the whole link — label and URL both — reads as one link.
  { tag: t.url, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.monospace, fontFamily: "var(--mono)", color: "var(--live)" },
  { tag: t.quote, color: "var(--ink-dim)", fontStyle: "italic" },
  // No t.list rule: @lezer/markdown tags every descendant of a list (marker
  // *and* item text) as tags.list, and list item text has no other, more
  // specific tag to fall back on — so a color rule here would dim ordinary
  // list content, not just markers. Markers are dimmed separately: ListMark
  // also carries tags.processingInstruction (see that rule below), which is
  // what actually colors bullets/ordered-list numbers.
  {
    tag: highlightTag,
    backgroundColor: "var(--pending-glow)",
    color: "var(--ink)",
    borderRadius: "3px",
  },
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

// Marks a transaction as "the parent pushed new content in", as opposed to
// the user typing. Without it a programmatic sync round-trips straight back
// out through onDocChanged → parent state → autosave, which is harmless while
// the parent is the only writer but becomes actively wrong the moment content
// can arrive from elsewhere (a note reloaded from disk after being edited in
// Obsidian would immediately be saved back over).
export const externalSync = Annotation.define<boolean>();

// Compartments make part of the config replaceable after the view exists.
// Worth being clear about the mental model, because it looks like shared
// mutable state and isn't: a Compartment is a *key*, not a value. Two live
// EditorViews can share one module-level compartment and each hold their own
// content under it, because the content lives in each EditorState — so this
// does not need to be a per-instance factory.
//
// Only things that actually change at runtime get one. The theme, the
// language config and the live-preview plugin deliberately don't: nothing
// reconfigures them, and a compartment per extension is pure ceremony.
export const completionCompartment = new Compartment();
export const placeholderCompartment = new Compartment();

export interface MarkdownEditorOptions {
  onDocChanged: (text: string) => void;
  placeholderText?: string;
  onOpenWikilink?: (target: string) => void;
  // Autocomplete sources, supplied by the consumer because they're
  // vault-dependent (see lib/markdownCompletions.ts). Reconfigurable, since
  // the vault index resolves asynchronously after mount.
  completions?: Extension;
}

export function buildMarkdownEditorExtensions({
  onDocChanged,
  placeholderText,
  onOpenWikilink,
  completions,
}: MarkdownEditorOptions): Extension[] {
  return [
    history(),
    indentUnit.of("  "),
    keymap.of([
      { key: "Tab", run: indentMore, shift: indentLess },
      { key: "Enter", run: continueList },
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      { key: "Mod-Shift-x", run: toggleStrikethrough },
      { key: "Mod-e", run: toggleInlineCode },
      { key: "Mod-k", run: insertLink },
      { key: "Mod-Alt-0", run: setHeadingLevel(0) },
      { key: "Mod-Alt-1", run: setHeadingLevel(1) },
      { key: "Mod-Alt-2", run: setHeadingLevel(2) },
      { key: "Mod-Alt-3", run: setHeadingLevel(3) },
      { key: "Mod-Alt-4", run: setHeadingLevel(4) },
      { key: "Mod-Alt-5", run: setHeadingLevel(5) },
      { key: "Mod-Alt-6", run: setHeadingLevel(6) },
      { key: "Mod-Shift-.", run: toggleBlockquote },
      { key: "Mod-Shift-8", run: toggleBulletList },
      { key: "Mod-Shift-7", run: toggleOrderedList },
      { key: "Mod-Shift-Enter", run: toggleTaskList },
      { key: "Mod-Shift-c", run: insertCodeFence },
      // After the custom bindings above, before defaultKeymap. Normal
      // precedence is fine — Mod-f/Mod-g/F3/Mod-d don't collide with
      // anything bound here.
      ...searchKeymap,
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
    // extensions: wikilinkExtension/highlightExtension — the same
    // [[Target]]/![[Target]] and ==highlight== grammars lib/markdown.ts's
    // preview uses, so the editor recognizes (and, for ==, live-preview
    // hides the marks of) exactly what the preview renders specially.
    markdown({
      addKeymap: false,
      base: markdownLanguage,
      codeLanguages: buildEditorCodeLanguageDescriptions(),
      extensions: [wikilinkExtension, highlightExtension],
    }),
    syntaxHighlighting(markdownHighlightStyle),
    markdownTheme,
    // Obsidian/Typora-style live preview: hides **/_/==/# marks except on
    // the line/range being edited, sizes headings, and turns task
    // checkboxes into real clickable inputs. See liveMarkdownPreview.ts.
    liveMarkdownPreview(),
    codeFenceCopyButton(),
    frontmatterFold(),
    clickableLinks({ onOpenWikilink }),
    markdownPaste(),
    markdownSearch(),
    EditorView.lineWrapping,
    placeholderCompartment.of(placeholder(placeholderText ?? "")),
    completionCompartment.of(completions ?? []),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      // Don't echo a parent-driven document replacement back out as if the
      // user had typed it — see the externalSync annotation above.
      if (update.transactions.some((tr) => tr.annotation(externalSync))) return;
      onDocChanged(update.state.doc.toString());
    }),
  ];
}
