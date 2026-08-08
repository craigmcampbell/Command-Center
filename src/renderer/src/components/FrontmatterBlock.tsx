// Collapsible YAML frontmatter for markdown *preview* panes (the CodeMirror
// editor's own fold — a separate mechanism — lives in lib/frontmatterFold.ts).
// Rendered as a real React-controlled <details> rather than embedded in the
// dangerouslySetInnerHTML blob lib/markdown.ts otherwise produces: the note
// body re-renders on every keystroke (and on unrelated app-level re-renders
// — Docker/GitHub/YNAB polling all live in the same top-level component
// tree), and each of those regenerates that HTML string fresh. A plain
// native <details open> living inside it has no React-visible state, so its
// open/closed attribute is just an incidental DOM mutation the browser made
// in response to a click — the next unrelated re-render overwrites it right
// back to whatever the regenerated string says, which looked like "closing
// it doesn't stick." Using real useState here means the collapse toggle is
// state React itself owns and preserves, independent of how often the
// sibling content around it re-renders.

import { useState } from "react";
import type { SyntheticEvent } from "react";
import { countFrontmatterProperties } from "../lib/frontmatter";

export default function FrontmatterBlock({ yaml }: { yaml: string }) {
  const [open, setOpen] = useState(false);
  const count = countFrontmatterProperties(yaml);
  const label = count > 0 ? `${count} propert${count === 1 ? "y" : "ies"}` : "Frontmatter";

  return (
    <details
      className="frontmatter"
      open={open}
      onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open)}
    >
      <summary>{label}</summary>
      <pre data-lang="">
        <code>{yaml}</code>
      </pre>
    </details>
  );
}
