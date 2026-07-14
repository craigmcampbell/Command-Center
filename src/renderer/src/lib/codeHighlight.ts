// Static syntax highlighting for fenced code blocks in the markdown preview
// — uses @lezer/highlight's highlightCode, the library's purpose-built
// helper for turning a standalone parsed code string into highlighted HTML
// outside of a live EditorView (highlightTree is the lower-level primitive
// this wraps). Emits the same "tok-*" classes CodeMirror's own default
// classHighlighter produces, styled in styles.css.

import { highlightCode, classHighlighter } from "@lezer/highlight";
import { findCodeLanguage } from "./codeLanguages";

// Local escapeHtml, not imported from ./markdown, to avoid a circular
// module dependency — markdown.ts imports highlightFencedCode from here.
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

export function highlightFencedCode(code: string, infoString: string): string {
  const lang = findCodeLanguage(infoString);
  if (!lang) return escapeHtml(code);

  try {
    const tree = lang.parser.parse(code);
    let html = "";
    highlightCode(
      code,
      tree,
      classHighlighter,
      (text, classes) => {
        html += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text);
      },
      () => {
        html += "\n";
      }
    );
    return html;
  } catch {
    return escapeHtml(code);
  }
}
