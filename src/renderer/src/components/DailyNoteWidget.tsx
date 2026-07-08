import type { DailyNoteResult } from "../../../shared/types";
import { renderMarkdown } from "../lib/markdown";
import Panel from "./Panel";
import { IconChevronLeft, IconChevronRight, IconExternal } from "./icons";

interface DailyNoteWidgetProps {
  data: DailyNoteResult | null;
  onNavigate: (date: string | null) => Promise<void>;
}

function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DailyNoteWidget({ data, onNavigate }: DailyNoteWidgetProps) {
  let body;
  if (!data) {
    body = <p className="muted">Loading daily note…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}. It'll appear once you create today's note.</p>;
  } else {
    body = (
      <div
        className="note"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(data.content) }}
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
