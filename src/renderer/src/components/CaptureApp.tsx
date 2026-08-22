import { useEffect, useRef, useState } from "react";
import type { CaptureTarget } from "../../../shared/types";

const TARGETS: { id: CaptureTarget; label: string }[] = [
  { id: "dailyNote", label: "Daily note" },
  { id: "scratchpad", label: "Scratchpad" },
];

export default function CaptureApp() {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<CaptureTarget>("dailyNote");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The window is shown/hidden rather than recreated, so React never
  // remounts between invocations — refocusing has to hang off the window's
  // own focus event, not off mount.
  useEffect(() => {
    const focusInput = () => inputRef.current?.focus();
    focusInput();
    window.addEventListener("focus", focusInput);
    return () => window.removeEventListener("focus", focusInput);
  }, []);

  // Same reason: clear the buffer when the panel is dismissed, so the next
  // summon is a blank slate rather than showing a stale half-thought.
  useEffect(() => {
    const reset = () => {
      setText("");
      setError(null);
    };
    window.addEventListener("blur", reset);
    return () => window.removeEventListener("blur", reset);
  }, []);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return; // whitespace-only is a no-op, not an error
    const result = await window.api.capture.submit(target, trimmed);
    if (!result.ok) {
      setError(result.reason ?? "Couldn't save");
      return;
    }
    setText("");
    setError(null);
    void window.api.capture.cancel(); // hides the panel
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      void window.api.capture.cancel();
      return;
    }
    // Enter commits; Shift+Enter is a newline, so multi-line captures are
    // still possible without a separate "save" affordance.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
      return;
    }
    // Tab cycles the target without leaving the keyboard.
    if (e.key === "Tab") {
      e.preventDefault();
      setTarget((t) => (t === "dailyNote" ? "scratchpad" : "dailyNote"));
    }
  }

  return (
    <div className="capture-panel">
      <textarea
        ref={inputRef}
        className="capture-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Capture a thought…"
        rows={2}
        autoFocus
      />
      <div className="capture-footer">
        <div className="capture-targets">
          {TARGETS.map((t) => (
            <button
              key={t.id}
              className={`capture-target ${target === t.id ? "active" : ""}`}
              onClick={() => {
                setTarget(t.id);
                inputRef.current?.focus();
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {error ? (
          <span className="capture-error">{error}</span>
        ) : (
          <span className="capture-hint">Tab to switch · Enter to save · Esc to dismiss</span>
        )}
      </div>
    </div>
  );
}
