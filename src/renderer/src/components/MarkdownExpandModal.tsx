// Full-window view of a markdown document already open in a MarkdownPane
// elsewhere on the page. Same scrim+panel overlay language as
// SettingsPage/NoteBrowserModal/TimeReportModal, just sized to take up most
// of the window instead of a fixed box. Renders its own MarkdownPane bound
// to the same value/onChange/docKey as the inline instance, so the two stay
// in sync without any shared editor state.

import { useCallback, useEffect } from "react";
import type { MouseEvent } from "react";
import { IconX } from "./icons";
import MarkdownPane, { MarkdownPaneToolbar } from "./MarkdownPane";
import type { ViewMode } from "./MarkdownPane";

interface MarkdownExpandModalProps {
  title: string;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  saving: boolean;
  value: string;
  onChange: (text: string) => void;
  docKey: string | number;
  placeholder?: string;
  onClose: () => void;
}

export default function MarkdownExpandModal({
  title,
  mode,
  onModeChange,
  saving,
  value,
  onChange,
  docKey,
  placeholder,
  onClose,
}: MarkdownExpandModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleScrimClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return (
    <div className="settings-scrim" onClick={handleScrimClick}>
      <div className="md-expand-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="settings-head">
          <h2>{title}</h2>
          <button className="settings-close" onClick={onClose} title="Close">
            <IconX />
          </button>
        </div>
        <MarkdownPaneToolbar
          mode={mode}
          onModeChange={onModeChange}
          saving={saving}
          className="md-expand-toolbar"
        />
        <div className="md-expand-body">
          <MarkdownPane
            mode={mode}
            value={value}
            onChange={onChange}
            docKey={docKey}
            placeholder={placeholder}
            className="md-expand-editor"
          />
        </div>
      </div>
    </div>
  );
}
