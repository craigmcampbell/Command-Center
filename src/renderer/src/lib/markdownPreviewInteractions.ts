// Shared click handling for rendered markdown previews. The HTML is injected
// via dangerouslySetInnerHTML, so individual elements can't carry their own
// React onClick handlers — every consumer instead attaches one of these to
// the wrapping preview <div> and lets it figure out what was clicked.

import type { MouseEvent } from "react";

export interface MarkdownPreviewHandlers {
  onToggleTask?: (from: number, to: number, nextChecked: boolean) => void;
  onOpenWikilink?: (filePath: string, label: string) => void;
}

export function handleMarkdownPreviewClick(
  e: MouseEvent<HTMLDivElement>,
  handlers: MarkdownPreviewHandlers
): void {
  const target = e.target as HTMLElement;

  const checkbox = target.closest<HTMLInputElement>("input[data-task-from]");
  if (checkbox && !checkbox.disabled) {
    const from = Number(checkbox.dataset.taskFrom);
    const to = Number(checkbox.dataset.taskTo);
    handlers.onToggleTask?.(from, to, checkbox.checked);
    return;
  }

  const link = target.closest<HTMLElement>("a[data-wikilink-path]");
  if (link) {
    e.preventDefault();
    const path = link.dataset.wikilinkPath;
    const label = link.dataset.wikilinkLabel;
    if (path && label) handlers.onOpenWikilink?.(path, label);
  }
}
