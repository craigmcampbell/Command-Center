import { useEffect, useRef } from "react";
import type { Extension } from "@codemirror/state";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  buildMarkdownEditorExtensions,
  completionCompartment,
  externalSync,
  placeholderCompartment,
} from "../lib/markdownEditor";
import { foldFrontmatterByDefault } from "../lib/frontmatterFold";
import { placeholder as cmPlaceholder } from "@codemirror/view";

interface MarkdownEditorProps {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  className?: string;
  // Mod+click on a [[wikilink]] — see lib/clickableLinks.ts. Omitted where
  // there's no vault to resolve against (Scratchpad, Daily Note), same as
  // resolveWikilink being omitted from those widgets' renderMarkdown calls.
  onOpenWikilink?: (target: string) => void;
  // Autocomplete sources. Vault-dependent and resolved asynchronously, so
  // this arrives after mount and is applied through a Compartment rather
  // than by recreating the editor (which would drop undo history).
  completions?: Extension;
  // Called with the live view once it exists, and with null on teardown, so
  // a toolbar can dispatch commands against it.
  //
  // Deliberately a callback rather than an imperative handle: useImperativeHandle
  // is a *layout* effect, so it attaches before the passive effect below has
  // created the view — a parent reading `handle.view` at attach time would
  // only ever see null, which is exactly the bug that left every toolbar
  // button permanently disabled. Calling from inside the mount effect makes
  // the timing explicit and correct.
  onViewReady?: (view: EditorView | null) => void;
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  onOpenWikilink,
  completions,
  onViewReady,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onOpenWikilinkRef = useRef(onOpenWikilink);
  onOpenWikilinkRef.current = onOpenWikilink;

  const onViewReadyRef = useRef(onViewReady);
  onViewReadyRef.current = onViewReady;

  useEffect(() => {
    if (!containerRef.current) return;

    const initialState = EditorState.create({
      doc: value,
      extensions: buildMarkdownEditorExtensions({
        onDocChanged: (text) => onChangeRef.current(text),
        placeholderText: placeholder,
        onOpenWikilink: (target) => onOpenWikilinkRef.current?.(target),
        completions,
      }),
    });
    const view = new EditorView({
      state: foldFrontmatterByDefault(initialState),
      parent: containerRef.current,
    });
    viewRef.current = view;
    onViewReadyRef.current?.(view);

    return () => {
      onViewReadyRef.current?.(null);
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally empty: the editor is created once. `value` changes after
    // mount are synced via the effect below instead of recreating the view,
    // which would drop cursor position and undo history on every render;
    // `placeholder`/`completions` changes go through their compartments.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;

    // Keep the cursor where it was. A bare full-document replace leaves the
    // selection at position 0, so any content arriving from outside (a parent
    // re-render, a note reloaded from disk) would silently jump the caret to
    // the top of the note mid-edit. Clamped, since the new doc may be shorter.
    //
    // Special case: when the new value *ends with* the whole old one, content
    // was prepended (the daily note applying its template around what you just
    // typed). Holding the caret at its absolute offset would drop it into the
    // inserted text; shifting it by the inserted length keeps it against the
    // same character it was already on.
    const prepended = current.length > 0 && value.endsWith(current);
    const previousHead = view.state.selection.main.head;
    const head = prepended
      ? previousHead + (value.length - current.length)
      : Math.min(previousHead, value.length);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: EditorSelection.cursor(head),
      annotations: externalSync.of(true),
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: completionCompartment.reconfigure(completions ?? []),
    });
  }, [completions]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: placeholderCompartment.reconfigure(cmPlaceholder(placeholder ?? "")),
    });
  }, [placeholder]);

  return <div ref={containerRef} className={className} />;
}
