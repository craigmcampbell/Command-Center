// Shared frontmatter (--- ... ---) detection — an optional leading YAML
// block, Obsidian's "Properties" panel. Only ever valid at the very start of
// a document; an opening "---" with no matching closing line later in the
// doc is just a thematic break (<hr>), not frontmatter, so callers fall
// through to normal markdown handling in that case rather than swallowing
// the rest of the note. Both the live editor (frontmatterFold.ts) and the
// static preview (markdown.ts) scan for this independently — one walks
// CodeMirror's Text line-by-line, the other slices a plain string — so only
// the "what counts as a delimiter/property" rules live here, shared, to
// keep them from drifting apart.

export const FRONTMATTER_DELIM = /^-{3,}\s*$/;

// Top-level YAML keys only (no leading whitespace) — a nested list/map entry
// under a key isn't its own property.
export function countFrontmatterProperties(yaml: string): number {
  const matches = yaml.match(/^[A-Za-z0-9_-]+\s*:/gm);
  return matches ? matches.length : 0;
}

export interface FrontmatterSpan {
  yaml: string;
  // End offset of the closing "---" line (exclusive of its own newline) —
  // everything from 0 to here is the frontmatter block.
  to: number;
}

// Plain-string version for the static preview, which always has the whole
// note in hand already (as opposed to the editor, which re-derives this
// from live CodeMirror state on every relevant update — see
// frontmatterFold.ts's findFrontmatter).
export function splitFrontmatter(md: string): FrontmatterSpan | null {
  if (!md.startsWith("---")) return null;
  const firstLineEnd = md.indexOf("\n");
  if (firstLineEnd < 0) return null; // "---" and nothing else — no body, no close
  if (!FRONTMATTER_DELIM.test(md.slice(0, firstLineEnd))) return null;

  let pos = firstLineEnd + 1;
  while (pos <= md.length) {
    const nextNl = md.indexOf("\n", pos);
    const lineEnd = nextNl < 0 ? md.length : nextNl;
    if (FRONTMATTER_DELIM.test(md.slice(pos, lineEnd))) {
      return { yaml: md.slice(firstLineEnd + 1, pos), to: lineEnd };
    }
    if (nextNl < 0) break;
    pos = nextNl + 1;
  }
  return null;
}
