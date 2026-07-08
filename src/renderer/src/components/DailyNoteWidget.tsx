import type { DailyNoteResult } from "../../../shared/types";
import { renderMarkdown } from "../lib/markdown";
import Panel from "./Panel";

interface DailyNoteWidgetProps {
  data: DailyNoteResult | null;
}

export default function DailyNoteWidget({ data }: DailyNoteWidgetProps) {
  const dateTag = data ? data.file.split("/").pop()!.replace(".md", "") : "";

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
    <Panel title="Today's Log" headerRight={<span className="tag">{dateTag}</span>}>
      {body}
    </Panel>
  );
}
