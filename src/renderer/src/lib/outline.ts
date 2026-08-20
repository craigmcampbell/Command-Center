// Extracts a document's heading structure for the outline popover.
//
// Built off the syntax tree rather than a line regex, which gets two things
// right for free: "#" inside a fenced code block isn't a heading, and Setext
// ("underlined") headings are found as well as ATX ones. The level regex is
// the one already in lib/liveMarkdownPreview.ts — same definition of what
// counts as a heading, so the outline can't list something the editor styles
// differently.

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export interface OutlineHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  from: number;
}

const HEADING_NAME = /^(?:ATX|Setext)Heading([1-6])$/;

export function collectHeadings(state: EditorState): OutlineHeading[] {
  const headings: OutlineHeading[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      const match = HEADING_NAME.exec(node.type.name);
      if (!match) return;
      const line = state.doc.lineAt(node.from);
      // Strip the leading #s (ATX) — a Setext heading's text is already the
      // whole line, its underline being a separate line entirely.
      const text = line.text.replace(/^\s*#{1,6}\s*/, "").trim();
      headings.push({
        level: Number(match[1]) as OutlineHeading["level"],
        text: text || "(untitled)",
        from: node.from,
      });
    },
  });

  return headings;
}
