import { useEffect, useRef, useState } from "react";
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

  // Dates whose template has already been applied this session. Without this,
  // clearing the editor back to empty and typing again would prepend a second
  // copy of the template — `data.missing` can still be true at that point,
  // since it only refreshes on a reload.
  const seeded = useRef(new Set<string>());

  function handleContentChange(text: string) {
    if (!data) return;

    // First keystroke into a note that doesn't exist yet: this IS the moment
    // of creation, so the template gets applied now, with what was just typed
    // appended after it. Nothing is shown before this point — an empty editor
    // is the honest representation of a file that isn't there.
    let next = text;
    if (data.missing && data.templateContent && !seeded.current.has(data.date)) {
      seeded.current.add(data.date);
      next = `${data.templateContent.replace(/\s+$/, "")}\n${text}`;
    }

    // Typing is what creates the file (the queued save writes it moments from
    // now), so stop reporting the note as missing — otherwise the header keeps
    // saying "Start typing to create …" at someone who is already typing, and
    // the save status stays hidden so they never see it persist.
    const created = data.missing
      ? { ok: true, missing: false, reason: undefined }
      : null;

    onChange({ ...data, ...created, content: next });
    autosave.schedule(data.date, next);
  }

  // Quick capture appends to today's note from the main process. App.tsx
  // re-reads the file; this drops any queued save first, because flushing it
  // afterwards would write our pre-capture buffer over the captured line.
  // The cancel is synchronous and the refetch is not, so ordering holds.
  // Only cancel when the viewed day is today — capture never writes another
  // day's file, and cancelling a different date would drop unrelated edits.
  const viewingDate = data?.date;
  useEffect(() => {
    return window.api.onCommand((command) => {
      if (command.type !== "captured" || command.target !== "dailyNote") return;
      if (viewingDate && viewingDate === todayDateString()) {
        autosave.cancel(viewingDate);
      }
    });
  }, [autosave.cancel, viewingDate]);

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
          // "Saved" beside a note that doesn't exist yet is a lie, and it's
          // part of what made an empty day look like a real one. The
          // "Start typing to create …" hint below says what's true instead.
          showStatus={!creating}
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
