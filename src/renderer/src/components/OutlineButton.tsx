// Heading outline for the current document, as a toolbar button + popover.
// Useful mainly on long daily notes, where scrolling to find a section is
// otherwise the slowest thing you do in the editor.
//
// Headings are collected when the popover opens rather than tracked live —
// the outline is only ever looked at while it's open, and recomputing it on
// every keystroke would mean walking the syntax tree for nothing.

import { useEffect, useRef, useState } from "react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { collectHeadings } from "../lib/outline";
import type { OutlineHeading } from "../lib/outline";
import { IconOutline } from "./icons";

interface OutlineButtonProps {
  view: EditorView | null;
}

export default function OutlineButton({ view }: OutlineButtonProps) {
  const [open, setOpen] = useState(false);
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    if (!view) return;
    if (open) {
      setOpen(false);
      return;
    }
    setHeadings(collectHeadings(view.state));
    setOpen(true);
  }

  function jumpTo(from: number) {
    if (!view) return;
    setOpen(false);
    view.dispatch({
      selection: EditorSelection.cursor(from),
      effects: EditorView.scrollIntoView(from, { y: "start" }),
    });
    view.focus();
  }

  return (
    <div className="md-outline-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`md-toolbar-btn ${open ? "active" : ""}`}
        title="Outline"
        aria-label="Outline"
        aria-expanded={open}
        disabled={!view}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        <IconOutline />
      </button>
      {open && (
        <div className="md-outline-popover">
          {headings.length === 0 ? (
            <p className="muted md-outline-empty">No headings yet.</p>
          ) : (
            headings.map((h) => (
              <button
                key={`${h.from}-${h.text}`}
                type="button"
                className={`md-outline-item md-outline-h${h.level}`}
                onClick={() => jumpTo(h.from)}
              >
                {h.text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
