import { useState } from "react";
import type { DailyNoteResult } from "../../../shared/types";
import { useAutosave } from "../hooks/useAutosave";
import MarkdownPane, { MarkdownPaneToolbar } from "./MarkdownPane";
import type { ViewMode } from "./MarkdownPane";
import Panel from "./Panel";
import { IconChevronLeft, IconChevronRight, IconExternal } from "./icons";

interface DailyNoteWidgetProps {
  data: DailyNoteResult | null;
  onNavigate: (date: string | null) => Promise<void>;
  onChange: (result: DailyNoteResult) => void;
}

function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DailyNoteWidget({ data, onNavigate, onChange }: DailyNoteWidgetProps) {
  const [mode, setMode] = useState<ViewMode>("edit");
  // Keyed by date, so prev/next navigation can't make a pending save for one
  // day race an edit to another — they debounce independently.
  const autosave = useAutosave<string>((date, content) =>
    window.api.grimoire.saveDailyNote(date, content)
  );

  function handleContentChange(text: string) {
    if (!data) return;
    onChange({ ...data, content: text });
    autosave.schedule(data.date, text);
  }

  // A note that doesn't exist yet is editable anyway: saveDailyNote writes
  // unconditionally, so the first keystroke creates the file. Nothing here
  // needs a "create" call — the only thing that used to block this was the
  // widget rendering a dead-end message instead of an editor.
  const creating = !!data && !data.ok && !!data.missing;
  const editable = !!data && (data.ok || creating);

  let body;
  if (!data) {
    body = <p className="muted">Loading daily note…</p>;
  } else if (!editable) {
    body = <p className="muted">{data.reason}.</p>;
  } else {
    body = (
      <>
        <MarkdownPaneToolbar
          mode={mode}
          onModeChange={setMode}
          saving={autosave.savingKey !== null}
          value={data.content}
          className="daily-note-toolbar"
        >
          {creating && (
            <span className="scratchpad-status muted">Start typing to create {data.date}</span>
          )}
        </MarkdownPaneToolbar>
        <MarkdownPane
          mode={mode}
          value={data.content}
          onChange={handleContentChange}
          docKey={data.date}
          className="daily-note-editor"
          placeholder={creating ? `Start today's log…` : undefined}
        />
      </>
    );
  }

  return (
    <Panel
      title="Today's Log"
      headerRight={
        <div className="daily-nav">
          <button
            className="daily-nav-btn today-btn"
            disabled={data?.date === todayDateString()}
            onClick={() => onNavigate(null)}
            title="Jump to today"
          >
            Today
          </button>
          <button
            className="daily-nav-btn"
            disabled={!data?.prevDate}
            onClick={() => data?.prevDate && onNavigate(data.prevDate)}
            title="Previous note"
          >
            <IconChevronLeft />
          </button>
          <span className="tag">{data?.date || ""}</span>
          <button
            className="daily-nav-btn"
            disabled={!data?.nextDate}
            onClick={() => data?.nextDate && onNavigate(data.nextDate)}
            title="Next note"
          >
            <IconChevronRight />
          </button>
          {data?.obsidianUri && (
            <button
              className="daily-nav-btn"
              onClick={() => window.api.openUrl(data.obsidianUri)}
              title="Open in Obsidian"
            >
              <IconExternal />
            </button>
          )}
        </div>
      }
    >
      {body}
    </Panel>
  );
}
