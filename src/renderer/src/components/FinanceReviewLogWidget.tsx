import { useState } from "react";
import type { NoteContent } from "../../../shared/types";
import { useAutosave } from "../hooks/useAutosave";
import Panel from "./Panel";
import MarkdownPane, { MarkdownPaneToolbar } from "./MarkdownPane";
import type { ViewMode } from "./MarkdownPane";

interface FinanceReviewLogWidgetProps {
  data: NoteContent | null;
  onChange: (data: NoteContent) => void;
}

// One fixed document — constant autosave key and constant docKey, so the
// editor never remounts.
const KEY = "finance-review-log";

export default function FinanceReviewLogWidget({ data, onChange }: FinanceReviewLogWidgetProps) {
  const [mode, setMode] = useState<ViewMode>("edit");
  const autosave = useAutosave<string>((_key, text) =>
    window.api.grimoire.saveFinanceReviewLog(text)
  );

  function handleChange(text: string) {
    if (!data?.ok) return;
    onChange({ ...data, content: text });
    autosave.schedule(KEY, text);
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

  return (
    <Panel
      title="Finance Review Log"
      headerRight={
        <MarkdownPaneToolbar
          mode={mode}
          onModeChange={setMode}
          saving={autosave.savingKey !== null}
          value={data.content}
        />
      }
    >
      <MarkdownPane
        mode={mode}
        value={data.content}
        onChange={handleChange}
        docKey={KEY}
        placeholder="Log finance review notes…"
      />
    </Panel>
  );
}
