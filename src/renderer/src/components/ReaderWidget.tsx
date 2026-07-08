import { useState } from "react";
import type { ReaderDocument, ReaderResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconArchive, IconChevronLeft, IconChevronRight, IconExternal, IconTrash } from "./icons";

interface ReaderWidgetProps {
  data: ReaderResult | null;
  onNavigate: (page: number) => void;
  onChange: (result: ReaderResult) => void;
}

function formatSavedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ReaderRow({
  doc,
  page,
  onChange,
}: {
  doc: ReaderDocument;
  page: number;
  onChange: (result: ReaderResult) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleArchive() {
    if (!window.confirm(`Archive "${doc.title}"? It'll disappear from this list.`)) return;
    setBusy(true);
    const res = await window.api.reader.archive(doc.id, page);
    if (res.ok) {
      onChange(res);
    } else {
      window.alert(res.reason || "Couldn't archive this document.");
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Permanently delete "${doc.title}" from Readwise? This can't be undone.`))
      return;
    setBusy(true);
    const res = await window.api.reader.delete(doc.id, page);
    if (res.ok) {
      onChange(res);
    } else {
      window.alert(res.reason || "Couldn't delete this document.");
      setBusy(false);
    }
  }

  return (
    <div className="reader-item">
      <div className="row reader-row">
        <span className="name link" onClick={() => window.api.openUrl(doc.url)}>
          {doc.title}
          <IconExternal className="external-icon" />
        </span>
        <span className="due-meta">
          {doc.author && <span className="tag-chip">{doc.author}</span>}
          <span className="tag">{formatSavedDate(doc.savedAt)}</span>
        </span>
        <span className="row-actions">
          <button className="row-action" onClick={handleArchive} disabled={busy} title="Archive">
            <IconArchive />
          </button>
          <button
            className="row-action danger"
            onClick={handleDelete}
            disabled={busy}
            title="Delete permanently"
          >
            <IconTrash />
          </button>
        </span>
      </div>
    </div>
  );
}

export default function ReaderWidget({ data, onNavigate, onChange }: ReaderWidgetProps) {
  let body;
  if (!data) {
    body = <p className="muted">Loading Reader…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}.</p>;
  } else if (data.documents.length === 0) {
    body = (
      <p className="muted">
        {data.page === 0 ? "Nothing saved to Reader yet." : "No more items."}
      </p>
    );
  } else {
    body = data.documents.map((doc) => (
      <ReaderRow key={doc.id} doc={doc} page={data.page} onChange={onChange} />
    ));
  }

  const page = data?.page ?? 0;

  return (
    <Panel
      title="Reader"
      headerRight={
        <div className="daily-nav">
          <button
            className="daily-nav-btn"
            disabled={!data?.hasPrev}
            onClick={() => onNavigate(page - 1)}
            title="Previous page"
          >
            <IconChevronLeft />
          </button>
          <span className="tag">Page {page + 1}</span>
          <button
            className="daily-nav-btn"
            disabled={!data?.hasNext}
            onClick={() => onNavigate(page + 1)}
            title="Next page"
          >
            <IconChevronRight />
          </button>
        </div>
      }
    >
      {body}
    </Panel>
  );
}
