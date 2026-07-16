import type { NoteContent } from "../../../shared/types";
import { renderMarkdown } from "../lib/markdown";
import Panel from "./Panel";

interface FinanceReviewLogWidgetProps {
  data: NoteContent | null;
}

export default function FinanceReviewLogWidget({ data }: FinanceReviewLogWidgetProps) {
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
    <Panel title="Finance Review Log">
      <div className="note" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.content) }} />
    </Panel>
  );
}
