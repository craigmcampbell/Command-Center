import { useEffect, useState } from "react";
import { useAutosave } from "../hooks/useAutosave";
import Panel from "./Panel";
import MarkdownPane, { MarkdownPaneToolbar } from "./MarkdownPane";
import type { ViewMode } from "./MarkdownPane";
import { IconTrash } from "./icons";

// One document, so the autosave key is a constant — the hook is keyed for
// NotesWidget's sake (several notes open at once). Same reason docKey below
// is constant: the Scratchpad's document identity never changes, so the
// editor should never remount.
const KEY = "scratchpad";

export default function ScratchpadWidget() {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [mode, setMode] = useState<ViewMode>("edit");
  const autosave = useAutosave<string>((_key, text) => window.api.scratchpad.save(text));

  useEffect(() => {
    window.api.scratchpad.get().then((text) => {
      setContent(text);
      setLoaded(true);
    });
  }, []);

  // Quick capture appends to the scratchpad from the main process, behind this
  // component's back. Our in-memory copy is now stale, and the next keystroke
  // would autosave it straight over the captured line — so drop any queued
  // save (same reasoning as handleClear below) and reload from source.
  useEffect(() => {
    return window.api.onCommand((command) => {
      if (command.type !== "captured" || command.target !== "scratchpad") return;
      autosave.cancel(KEY);
      void window.api.scratchpad.get().then(setContent);
    });
  }, [autosave]);

  function handleChange(text: string) {
    setContent(text);
    autosave.schedule(KEY, text);
  }

  async function handleClear() {
    // Drop the queued save rather than flushing it — we're about to write ""
    // ourselves, and flushing would write the pre-clear text on top of it.
    autosave.cancel(KEY);
    setContent("");
    setClearing(true);
    await window.api.scratchpad.clear();
    setClearing(false);
  }

  if (!loaded) {
    return (
      <Panel title="Scratchpad">
        <p className="muted">Loading…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Scratchpad"
      headerRight={
        <MarkdownPaneToolbar
          mode={mode}
          onModeChange={setMode}
          saving={autosave.savingKey !== null || clearing}
          value={content}
        >
          <button
            type="button"
            className="scratchpad-clear"
            onClick={handleClear}
            disabled={!content}
            title="Clear note"
          >
            <IconTrash />
            Clear
          </button>
        </MarkdownPaneToolbar>
      }
    >
      <MarkdownPane
        mode={mode}
        value={content}
        onChange={handleChange}
        docKey={KEY}
        placeholder="Jot something down… supports markdown headings, nested bullets, tasks, bold, and italic."
      />
    </Panel>
  );
}
