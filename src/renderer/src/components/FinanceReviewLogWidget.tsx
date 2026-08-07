import { useCallback, useRef, useState } from "react";
import type { NoteContent } from "../../../shared/types";
import { renderMarkdown } from "../lib/markdown";
import { handleMarkdownPreviewClick } from "../lib/markdownPreviewInteractions";
import Panel from "./Panel";
import MarkdownEditor from "./MarkdownEditor";

interface FinanceReviewLogWidgetProps {
  data: NoteContent | null;
  onChange: (data: NoteContent) => void;
}

type ViewMode = "edit" | "split" | "preview";

const AUTOSAVE_MS = 500;

export default function FinanceReviewLogWidget({ data, onChange }: FinanceReviewLogWidgetProps) {
  const [mode, setMode] = useState<ViewMode>("split");
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scheduleSave = useCallback((text: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await window.api.grimoire.saveFinanceReviewLog(text);
      setSaving(false);
    }, AUTOSAVE_MS);
  }, []);

  function handleChange(text: string) {
    if (!data?.ok) return;
    onChange({ ...data, content: text });
    scheduleSave(text);
  }

  function handleToggleTask(from: number, to: number, checked: boolean) {
    if (!data?.ok) return;
    handleChange(data.content.slice(0, from) + (checked ? "[x]" : "[ ]") + data.content.slice(to));
  }

  if (!data) {
    return (
      <Panel title="Finance Review Log">
        <p className="muted">Loading…</p>
      </Panel>
    );
  }

  if (!data.ok) {
    return (
      <Panel title="Finance Review Log" headerRight={<span className="pip alert"></span>}>
        <p className="muted">{data.reason}.</p>
      </Panel>
    );
  }

  const showEditor = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  return (
    <Panel
      title="Finance Review Log"
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
        </div>
      }
    >
      <div className={`scratchpad ${mode}`}>
        {showEditor && (
          <MarkdownEditor
            className="scratchpad-editor"
            value={data.content}
            onChange={handleChange}
            placeholder="Log finance review notes…"
          />
        )}
        {showPreview && (
          <div
            className="scratchpad-preview note"
            onClick={(e) => handleMarkdownPreviewClick(e, { onToggleTask: handleToggleTask })}
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(data.content, { interactiveTasks: true }),
            }}
          />
        )}
      </div>
    </Panel>
  );
}
