import type { DailyNoteResult } from "../../../shared/types";
import { renderMarkdown } from "../lib/markdown";
import { handleMarkdownPreviewClick } from "../lib/markdownPreviewInteractions";
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
    body = (
      <div
        className="note"
        onClick={(e) => handleMarkdownPreviewClick(e, { onToggleTask: handleToggleTask })}
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(data.content, { interactiveTasks: true }),
        }}
      />
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
