import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { PaletteAction, PaletteContext } from "../palette";
import { buildActions, filterActions } from "../palette";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  context: PaletteContext;
}

export default function CommandPalette({ open, onClose, context }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<PaletteAction[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Rebuild the action list fresh every time the palette opens, so newly
  // started containers / added projects always show up.
  useEffect(() => {
    if (!open) return;
    setActions(buildActions(context));
    setQuery("");
    setSelectedIndex(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => filterActions(actions, query), [actions, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, open]);

  if (!open) return null;

  async function runAction(action: PaletteAction) {
    onClose();
    try {
      await action.run();
    } catch {
      // Individual actions call fail-soft IPC methods already; nothing to
      // surface here beyond not letting a rejection escape as a console error.
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[selectedIndex];
      if (action) void runAction(action);
    }
  }

  function handleScrimClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="palette-scrim" onClick={handleScrimClick}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <p className="palette-empty">No matching commands</p>}
          {filtered.map((action, i) => (
            <div
              key={action.id}
              data-index={i}
              className={`palette-row ${i === selectedIndex ? "selected" : ""}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => void runAction(action)}
            >
              <span className="palette-title">{action.title}</span>
              <span className="palette-category">{action.category}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
