// Autocomplete for the markdown editor: "[[" opens a vault-note picker, and
// "/" at the start of a line offers block snippets.
//
// The wikilink source is vault-dependent, so it's built by the consumer that
// has an index (only NotesWidget) and handed down. Scratchpad/Daily Note/
// Finance get the slash commands but no "[[" source — their previews render
// wikilinks inert for want of a vault to resolve against (see
// lib/markdown.ts), and completing links that render dead would be worse
// than offering none.

import { autocompletion, completionKeymap, snippetCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { VaultNoteIndexEntry } from "../../../shared/types";

// ---- [[wikilink]] ----

function applyWikilink(target: string): NonNullable<Completion["apply"]> {
  return (view, _completion, from, to) => {
    // Only add the closing brackets if they aren't already there. Typing
    // "[[" leaves none (nothing auto-closes them here), but completing
    // inside an existing "[[...]]" must not produce "[[Note]]]]".
    const hasClose = view.state.sliceDoc(to, to + 2) === "]]";
    const insert = hasClose ? target : `${target}]]`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length + (hasClose ? 2 : 0) },
    });
  };
}

export function wikilinkCompletionSource(entries: VaultNoteIndexEntry[]): CompletionSource {
  // A basename appearing in more than one folder can't be completed by
  // basename alone — inserting the full path is what makes the completion
  // resolve back to the file it came from, matching NotesWidget's
  // exact-path-then-basename resolution order.
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.basename, (counts.get(entry.basename) ?? 0) + 1);
  }

  const options: Completion[] = entries.map((entry) => ({
    label: entry.basename,
    detail: entry.path,
    type: "text",
    apply: applyWikilink(
      (counts.get(entry.basename) ?? 0) > 1 ? entry.path.replace(/\.md$/i, "") : entry.basename
    ),
  }));

  return (context): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^\]\n]*/);
    if (!match) return null;
    return {
      from: match.from + 2,
      options,
      // Lets CodeMirror re-filter the existing option list as you keep
      // typing instead of calling this source again per keystroke. With a
      // few thousand vault notes that's the difference between usable and
      // laggy, since `options` is rebuilt from scratch on every call.
      validFor: /^[^\]\n]*$/,
    };
  };
}

// ---- /slash commands ----

function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const SNIPPETS: Completion[] = [
  snippetCompletion("| ${Column} | ${Column} |\n| --- | --- |\n| ${} | ${} |", {
    label: "/table",
    detail: "table",
    type: "keyword",
  }),
  snippetCompletion("```${language}\n${}\n```", {
    label: "/code",
    detail: "fenced code block",
    type: "keyword",
  }),
  snippetCompletion("- [ ] ${}", { label: "/todo", detail: "task", type: "keyword" }),
  snippetCompletion("> ${}", { label: "/quote", detail: "blockquote", type: "keyword" }),
  { label: "/hr", detail: "horizontal rule", type: "keyword", apply: "---\n" },
  {
    label: "/date",
    detail: "today's date",
    type: "keyword",
    // Computed when applied, not at module load — this dashboard gets left
    // open, so a date captured at boot would go stale overnight.
    apply: (view, _completion, from, to) =>
      view.dispatch({ changes: { from, to, insert: todayDateString() } }),
  },
];

// Deliberately no "/callout": lib/markdown.ts doesn't understand Obsidian's
// "> [!note]" syntax, so it would render as a plain blockquote in preview.
// Inserting syntax this app's own renderer disagrees with is exactly what
// wikilinkExtension.ts / codeLanguages.ts / matchListLine all exist to
// prevent. It belongs with real callout support, not before it.
export const slashCommandSource: CompletionSource = (context) => {
  const match = context.matchBefore(/\/\w*/);
  if (!match) return null;
  // Line start only, leading whitespace allowed so it works inside a list
  // item. Without this guard every "/" in a URL or a date pops the menu.
  const line = context.state.doc.lineAt(context.pos);
  if (line.text.slice(0, match.from - line.from).trim() !== "") return null;
  return { from: match.from, options: SNIPPETS, validFor: /^\/\w*$/ };
};

// The popup is CodeMirror-owned DOM, so it's themed here rather than in
// styles.css — same split as everything else inside the editor.
const completionTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background: "var(--panel)",
    border: "1px solid var(--panel-edge)",
    borderRadius: "6px",
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--mono)",
    fontSize: "12px",
    maxHeight: "16em",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "4px 10px",
    color: "var(--ink)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "var(--accent-glow)",
    color: "var(--accent)",
  },
  ".cm-completionDetail": {
    color: "var(--ink-dim)",
    fontStyle: "normal",
    marginLeft: "10px",
    fontSize: "11px",
  },
  ".cm-completionMatchedText": {
    color: "var(--live)",
    textDecoration: "none",
    fontWeight: "700",
  },
  // The ${} slots you Tab between after accepting /table or /code.
  ".cm-snippetField": {
    backgroundColor: "var(--pending-glow)",
  },
});

export function markdownCompletions(wikilinkSource?: CompletionSource | null): Extension {
  const sources = wikilinkSource ? [slashCommandSource, wikilinkSource] : [slashCommandSource];
  return [
    autocompletion({ override: sources, activateOnTyping: true, icons: false }),
    // Prec.highest is both correct and safe here, which is worth spelling
    // out because it looks like it would break Enter. completionKeymap binds
    // Enter to acceptCompletion and Tab to snippet-field navigation, and this
    // editor already binds both (continueList, indentMore). Those commands
    // return false when no popup or active snippet exists, so the key falls
    // straight through to the existing binding. Registering at normal
    // precedence instead would leave the winner up to facet-input ordering,
    // which is fragile — the same class of problem the `addKeymap: false`
    // comment in markdownEditor.ts describes.
    Prec.highest(keymap.of(completionKeymap)),
    completionTheme,
  ];
}
