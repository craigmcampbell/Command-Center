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

  const copyBtn = target.closest<HTMLButtonElement>("button[data-copy-code]");
  if (copyBtn) {
    // dataset decodes the HTML entities lib/markdown.ts's escapeAttr encoded
    // (&amp;/&lt;/&gt;/&quot;) back to the original source text, so this is
    // the raw fence contents, not whatever highlightFencedCode wrapped it in.
    const code = copyBtn.dataset.copyCode ?? "";
    void navigator.clipboard.writeText(code).then(() => {
      copyBtn.classList.add("copied");
      window.setTimeout(() => copyBtn.classList.remove("copied"), 1200);
    });
    return;
  }

  const wikilink = target.closest<HTMLElement>("a[data-wikilink-path]");
  if (wikilink) {
    e.preventDefault();
    const path = wikilink.dataset.wikilinkPath;
    const label = wikilink.dataset.wikilinkLabel;
    if (path && label) handlers.onOpenWikilink?.(path, label);
    return;
  }

  // Any other rendered link — a plain [text](url), autolink, or bare URL —
  // opens in the system browser instead of navigating this Electron window
  // itself, which has no address bar or back button and would just strand
  // the app on whatever external page got clicked.
  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (link) {
    e.preventDefault();
    const href = link.getAttribute("href");
    if (href) void window.api.openUrl(href);
  }
}
