// The markdown editing surface shared by every consumer — Scratchpad,
// Notes, Daily Note, Finance Review Log. Each of those used to carry its own
// byte-identical copy of the Write/Preview pills, the Saving…/Saved label,
// the task-toggle slice-splice, and the whole preview block; they had already
// drifted apart in three places by the time this was extracted.
//
// Two exports rather than one component, because the consumers disagree
// about where the toolbar goes: Scratchpad and Finance put it in Panel's
// `headerRight`, Notes and Daily Note put it inside their own body layout.
// A single component can't render into both without a portal, which is more
// machinery than it removes — so the toolbar is its own piece the consumer
// places, and MarkdownPane is just the editor/preview body.

import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import type { VaultNoteIndexEntry } from "../../../shared/types";
import type { ResolvedWikilink } from "../lib/markdown";
import { markdownCompletions, wikilinkCompletionSource } from "../lib/markdownCompletions";
import { renderMarkdown } from "../lib/markdown";
import { splitFrontmatter } from "../lib/frontmatter";
import { handleMarkdownPreviewClick } from "../lib/markdownPreviewInteractions";
import { toggleTaskAt } from "../lib/markdownTasks";
import FrontmatterBlock from "./FrontmatterBlock";
import MarkdownEditor from "./MarkdownEditor";
import MarkdownToolbar from "./MarkdownToolbar";
import { IconExpand } from "./icons";

export type ViewMode = "edit" | "preview";

export const VIEW_MODES: readonly ViewMode[] = ["edit", "preview"] as const;

interface MarkdownPaneToolbarProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  saving: boolean;
  // NotesWidget hides the status entirely when the active note failed to
  // read — "Saved" next to a read error would be actively misleading.
  showStatus?: boolean;
  // Which wrapper class the consumer's layout expects: "scratchpad-toolbar"
  // in a Panel header, "notes-toolbar"/"daily-note-toolbar" in a body.
  className?: string;
  // Renders an expand button that calls back into the consumer, which is
  // what actually owns the "open in a modal" state — the toolbar just
  // exposes the affordance.
  onExpand?: () => void;
  // Extra controls after the status label (Scratchpad's Clear button).
  children?: ReactNode;
}

export function MarkdownPaneToolbar({
  mode,
  onModeChange,
  saving,
  showStatus = true,
  className = "scratchpad-toolbar",
  onExpand,
  children,
}: MarkdownPaneToolbarProps) {
  return (
    <div className={className}>
      <div className="scratchpad-modes">
        {VIEW_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`scratchpad-mode ${mode === m ? "active" : ""}`}
            onClick={() => onModeChange(m)}
          >
            {m === "edit" ? "Write" : "Preview"}
          </button>
        ))}
      </div>
      {showStatus && (
        <span className="scratchpad-status">{saving ? "Saving…" : "Saved"}</span>
      )}
      {onExpand && (
        <button
          type="button"
          className="md-expand-btn"
          onClick={onExpand}
          title="Expand"
          aria-label="Expand"
        >
          <IconExpand />
        </button>
      )}
      {children}
    </div>
  );
}

interface MarkdownPaneProps {
  mode: ViewMode;
  value: string;
  onChange: (text: string) => void;
  // Identifies the document being edited. Required rather than optional on
  // purpose: it becomes the editor's React key, and frontmatter-collapsed-
  // by-default is applied when the EditorState is *created*, so reusing one
  // CodeMirror instance across two different notes would carry the previous
  // one's fold state over. Consumers whose document identity never changes
  // (Scratchpad, Finance) pass a constant, which correctly never remounts.
  // Making it required is what stops a new consumer forgetting it — two of
  // the original four did.
  docKey: string | number;
  placeholder?: string;
  // Extra class alongside `.scratchpad` (e.g. "daily-note-editor").
  className?: string;
  // Both omitted where there's no vault to resolve against (Scratchpad,
  // Daily Note, Finance), which is what makes wikilinks render inert there.
  resolveWikilink?: (target: string) => ResolvedWikilink | null;
  onOpenWikilink?: (filePath: string, label: string) => void;
  // Backs "[[" autocomplete. Arrives asynchronously (NotesWidget fetches it
  // the first time a note from that vault is opened), which is precisely why
  // MarkdownEditor applies it through a Compartment instead of remounting.
  vaultIndex?: VaultNoteIndexEntry[];
  // Set when a save was refused because the file changed on disk. Rendered
  // as a bar above the editor, never a modal — the unsaved text is sitting in
  // the buffer and has to stay reachable while you decide.
  conflict?: {
    message: string;
    onReload: () => void;
    onOverwrite: () => void;
  } | null;
}

export default function MarkdownPane({
  mode,
  value,
  onChange,
  docKey,
  placeholder,
  className,
  resolveWikilink,
  onOpenWikilink,
  vaultIndex,
  conflict,
}: MarkdownPaneProps) {
  const fm = splitFrontmatter(value);
  // State, not a ref: the toolbar has to re-render once the view exists to
  // enable its buttons, and a ref assignment wouldn't trigger that.
  // onViewReady fires from the editor's mount effect and again with null on
  // teardown — including when docKey changes, which is exactly when the
  // underlying view is replaced.
  const [view, setView] = useState<EditorView | null>(null);
  // Stable identity so MarkdownEditor's mount effect isn't re-run just
  // because this component re-rendered.
  const captureEditor = useCallback((v: EditorView | null) => setView(v), []);

  // Rebuilding the wikilink source walks the whole vault index, so memoize
  // on the index identity — the Compartment reconfigure effect downstream is
  // keyed on this value, and a fresh object every render would re-dispatch
  // on every keystroke.
  const completions = useMemo(
    () => markdownCompletions(vaultIndex ? wikilinkCompletionSource(vaultIndex) : null),
    [vaultIndex]
  );

  // The editor reports a wikilink click as a raw [[target]] string while the
  // preview reports an already-resolved (filePath, label) pair. Bridging the
  // two here means consumers only ever supply the one resolved-form callback.
  function handleEditorWikilink(target: string): void {
    const resolved = resolveWikilink?.(target);
    if (resolved) onOpenWikilink?.(resolved.filePath, resolved.label);
  }

  return (
    <div className={`scratchpad ${className ? `${className} ` : ""}${mode}`}>
      {mode === "edit" && (
        <div className="scratchpad-edit-pane">
          {conflict && (
            <div className="md-conflict">
              <span className="md-conflict-message">{conflict.message}</span>
              <button type="button" className="md-conflict-btn" onClick={conflict.onReload}>
                Reload from disk
              </button>
              <button type="button" className="md-conflict-btn" onClick={conflict.onOverwrite}>
                Keep mine
              </button>
            </div>
          )}
          <MarkdownToolbar view={view} />
          <MarkdownEditor
            key={docKey}
            className="scratchpad-editor"
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            onOpenWikilink={onOpenWikilink ? handleEditorWikilink : undefined}
            completions={completions}
            onViewReady={captureEditor}
          />
        </div>
      )}
      {mode === "preview" && (
        <div className="scratchpad-preview note">
          {/* includeFrontmatter is always false here, paired with this real
              React <FrontmatterBlock> — one of the four consumers used to
              omit the option and so rendered neither. */}
          {fm && <FrontmatterBlock key={docKey} yaml={fm.yaml} />}
          <div
            onClick={(e) =>
              handleMarkdownPreviewClick(e, {
                onToggleTask: (from, to, checked) =>
                  onChange(toggleTaskAt(value, from, to, checked)),
                onOpenWikilink,
              })
            }
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(value, {
                interactiveTasks: true,
                resolveWikilink,
                includeFrontmatter: false,
              }),
            }}
          />
        </div>
      )}
    </div>
  );
}
