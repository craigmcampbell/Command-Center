// Formatting buttons for the markdown editor. Every command here already
// existed as a keybinding — this exists purely for discoverability, since
// keyboard-only formatting has no visual affordance at all and nothing tells
// you the shortcuts are there.
//
// The buttons are deliberately stateless: no "bold is currently on"
// highlighting. Tracking that means resolving the syntax tree at the cursor
// on every selection change and pushing the result into React state, i.e. a
// re-render per caret move, for a purely cosmetic gain. Obsidian's own mobile
// toolbar behaves the same way. Each button's title carries its shortcut,
// which is the part people actually want to learn.

import type { Command, EditorView } from "@codemirror/view";
import {
  insertCodeFence,
  insertLink,
  insertTable,
  setHeadingLevel,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleTaskList,
} from "../lib/markdownEditor";
import {
  IconBold,
  IconCodeBlock,
  IconCodeInline,
  IconH1,
  IconH2,
  IconH3,
  IconItalic,
  IconLink,
  IconList,
  IconListOrdered,
  IconQuote,
  IconStrikethrough,
  IconTable,
  IconTask,
} from "./icons";
import OutlineButton from "./OutlineButton";

// macOS writes ⌘/⌥ in shortcut hints; everywhere else it's Ctrl/Alt. The
// renderer has no `process`, so sniff the UA the same way CodeMirror's own
// keymap does when resolving "Mod-".
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? "⌘" : "Ctrl+";
const alt = isMac ? "⌥" : "Alt+";
const shift = isMac ? "⇧" : "Shift+";

interface ToolbarItem {
  key: string;
  label: string;
  hint: string;
  command: Command;
  icon: typeof IconBold;
}

// Grouped by kind; `null` renders a separator.
const ITEMS: (ToolbarItem | null)[] = [
  { key: "bold", label: "Bold", hint: `${mod}B`, command: toggleBold, icon: IconBold },
  { key: "italic", label: "Italic", hint: `${mod}I`, command: toggleItalic, icon: IconItalic },
  {
    key: "strike",
    label: "Strikethrough",
    hint: `${mod}${shift}X`,
    command: toggleStrikethrough,
    icon: IconStrikethrough,
  },
  { key: "code", label: "Inline code", hint: `${mod}E`, command: toggleInlineCode, icon: IconCodeInline },
  null,
  { key: "h1", label: "Heading 1", hint: `${mod}${alt}1`, command: setHeadingLevel(1), icon: IconH1 },
  { key: "h2", label: "Heading 2", hint: `${mod}${alt}2`, command: setHeadingLevel(2), icon: IconH2 },
  { key: "h3", label: "Heading 3", hint: `${mod}${alt}3`, command: setHeadingLevel(3), icon: IconH3 },
  null,
  { key: "ul", label: "Bullet list", hint: `${mod}${shift}8`, command: toggleBulletList, icon: IconList },
  {
    key: "ol",
    label: "Numbered list",
    hint: `${mod}${shift}7`,
    command: toggleOrderedList,
    icon: IconListOrdered,
  },
  {
    key: "task",
    label: "Task",
    hint: `${mod}${shift}↵`,
    command: toggleTaskList,
    icon: IconTask,
  },
  null,
  { key: "quote", label: "Quote", hint: `${mod}${shift}.`, command: toggleBlockquote, icon: IconQuote },
  { key: "link", label: "Link", hint: `${mod}K`, command: insertLink, icon: IconLink },
  {
    key: "fence",
    label: "Code block",
    hint: `${mod}${shift}C`,
    command: insertCodeFence,
    icon: IconCodeBlock,
  },
  { key: "table", label: "Table", hint: "", command: insertTable, icon: IconTable },
];

interface MarkdownToolbarProps {
  // null until the editor mounts; buttons are disabled until then.
  view: EditorView | null;
}

export default function MarkdownToolbar({ view }: MarkdownToolbarProps) {
  function run(command: Command) {
    if (!view) return;
    command(view);
    // Formatting from a button shouldn't cost you your place in the text.
    view.focus();
  }

  return (
    <div className="md-toolbar">
      <OutlineButton view={view} />
      <span className="md-toolbar-sep" aria-hidden="true" />
      {ITEMS.map((item, i) =>
        item === null ? (
          <span key={`sep-${i}`} className="md-toolbar-sep" aria-hidden="true" />
        ) : (
          <button
            key={item.key}
            type="button"
            className="md-toolbar-btn"
            title={item.hint ? `${item.label} (${item.hint})` : item.label}
            aria-label={item.label}
            disabled={!view}
            // Keep focus in the editor: without this the button steals it on
            // mousedown, so the command runs against a collapsed selection.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(item.command)}
          >
            <item.icon />
          </button>
        )
      )}
    </div>
  );
}
