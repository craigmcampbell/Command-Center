import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyNoteResult } from "../../../shared/types";
import { renderMarkdown } from "../lib/markdown";
import { splitFrontmatter } from "../lib/frontmatter";
import { handleMarkdownPreviewClick } from "../lib/markdownPreviewInteractions";
import FrontmatterBlock from "./FrontmatterBlock";
import MarkdownEditor from "./MarkdownEditor";
import Panel from "./Panel";
import { IconChevronLeft, IconChevronRight, IconExternal } from "./icons";

interface DailyNoteWidgetProps {
  data: DailyNoteResult | null;
  onNavigate: (date: string | null) => Promise<void>;
  onChange: (result: DailyNoteResult) => void;
}

type ViewMode = "edit" | "split" | "preview";

const AUTOSAVE_MS = 500;

function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DailyNoteWidget({ data, onNavigate, onChange }: DailyNoteWidgetProps) {
  const [mode, setMode] = useState<ViewMode>("preview");
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const scheduleSave = useCallback((date: string, content: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await window.api.grimoire.saveDailyNote(date, content);
      setSaving(false);
    }, AUTOSAVE_MS);
  }, []);

  function handleContentChange(text: string) {
    if (!data || !data.ok) return;
    onChange({ ...data, content: text });
    scheduleSave(data.date, text);
  }

  async function handleToggleTask(from: number, to: number, checked: boolean) {
    if (!data || !data.ok) return;
    const content = data.content.slice(0, from) + (checked ? "[x]" : "[ ]") + data.content.slice(to);
    onChange({ ...data, content });
    await window.api.grimoire.saveDailyNote(data.date, content);
  }

  let body;
  if (!data) {
    body = <p className="muted">Loading daily note…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}. It'll appear once you create today's note.</p>;
  } else {
    const showEditor = mode === "edit" || mode === "split";
    const showPreview = mode === "preview" || mode === "split";
    const fm = splitFrontmatter(data.content);
    body = (
      <>
        <div className="daily-note-toolbar">
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
        <div className={`scratchpad daily-note-editor ${mode}`}>
          {showEditor && (
            <MarkdownEditor
              // Remounts per date, same as NotesWidget keying its editor by
              // note id — otherwise prev/next reuses one CodeMirror instance
              // across completely different notes, and frontmatter's
              // collapsed-by-default only applies at mount, not per note.
              key={data.date}
              className="scratchpad-editor"
              value={data.content}
              onChange={handleContentChange}
            />
          )}
          {showPreview && (
            <div className="scratchpad-preview note">
              {fm && <FrontmatterBlock key={data.date} yaml={fm.yaml} />}
              <div
                onClick={(e) => handleMarkdownPreviewClick(e, { onToggleTask: handleToggleTask })}
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(data.content, { interactiveTasks: true, includeFrontmatter: false }),
                }}
              />
            </div>
          )}
        </div>
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
