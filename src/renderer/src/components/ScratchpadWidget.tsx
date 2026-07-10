import { useCallback, useEffect, useRef, useState } from "react";
import { renderMarkdown } from "../lib/markdown";
import Panel from "./Panel";
import MarkdownEditor from "./MarkdownEditor";
import { IconTrash } from "./icons";

type ViewMode = "edit" | "split" | "preview";

const AUTOSAVE_MS = 500;

export default function ScratchpadWidget() {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ViewMode>("split");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    window.api.scratchpad.get().then((text) => {
      setContent(text);
      setLoaded(true);
    });
  }, []);

  const scheduleSave = useCallback((text: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await window.api.scratchpad.save(text);
      setSaving(false);
    }, AUTOSAVE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function handleChange(text: string) {
    setContent(text);
    scheduleSave(text);
  }

  async function handleClear() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setContent("");
    setSaving(true);
    await window.api.scratchpad.clear();
    setSaving(false);
  }

  if (!loaded) {
    return (
      <Panel title="Scratchpad">
        <p className="muted">Loading…</p>
      </Panel>
    );
  }

  const showEditor = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  return (
    <Panel
      title="Scratchpad"
      headerRight={
        <div className="scratchpad-toolbar">
          <div className="scratchpad-modes">
            {(["edit", "split", "preview"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`scratchpad-mode ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "edit" ? "Write" : m === "split" ? "Split" : "Preview"}
              </button>
            ))}
          </div>
          <span className="scratchpad-status">{saving ? "Saving…" : "Saved"}</span>
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
        </div>
      }
    >
      <div className={`scratchpad ${mode}`}>
        {showEditor && (
          <MarkdownEditor
            className="scratchpad-editor"
            value={content}
            onChange={handleChange}
            placeholder="Jot something down… supports markdown headings, nested bullets, tasks, bold, and italic."
          />
        )}
        {showPreview && (
          <div
            className="scratchpad-preview note"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(content) || '<p class="muted">Nothing to preview yet.</p>',
            }}
          />
        )}
      </div>
    </Panel>
  );
}
