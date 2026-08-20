// Markdown preview renderer — walks the same CommonMark+GFM parse tree
// CodeMirror's editor uses (via @lezer/markdown), so the editor's syntax
// highlighting and this preview never disagree about what's a heading, list,
// table, etc. Deliberately does not pass through raw HTML/entities/comments
// from the source (dangerouslySetInnerHTML downstream) — anything not
// explicitly handled below falls back to escaped plain text.

import { parser as baseParser, GFM } from "@lezer/markdown";
import type { SyntaxNode, Tree } from "@lezer/common";
import { highlightFencedCode } from "./codeHighlight";
import { wikilinkExtension } from "./wikilinkExtension";
import { highlightExtension } from "./highlightExtension";
import { countFrontmatterProperties, splitFrontmatter } from "./frontmatter";
import { normalizeBareUrl, safeUrl } from "./urls";

const parser = baseParser.configure([GFM, wikilinkExtension, highlightExtension]);

export interface ResolvedWikilink {
  filePath: string;
  label: string;
}

export interface RenderMarkdownOptions {
  interactiveTasks?: boolean;
  // Omitted entirely (Scratchpad/DailyNote, no vault context) → wikilinks
  // render inert. Provided but returns null (target doesn't match any file
  // in the vault) → renders as a visually distinct "broken" link.
  resolveWikilink?: (target: string) => ResolvedWikilink | null;
  // false → the frontmatter block (if any) is left out of the returned HTML
  // entirely, rather than embedded as a static <details>. For callers that
  // render their own <FrontmatterBlock> (see components/FrontmatterBlock.tsx)
  // instead — real React state for the collapse toggle, immune to having its
  // manually-collapsed state silently reset by an unrelated re-render
  // elsewhere in the app, which a plain dangerouslySetInnerHTML <details>
  // isn't. Defaults to true (single self-contained HTML string) for callers
  // — like the Todoist description panel — that don't need that.
  includeFrontmatter?: boolean;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// A link/image whose URL failed safeUrl. Rendered as a span, not a disabled
// <a> — an anchor would still carry the rejected URL in the DOM for some
// later refactor of markdownPreviewInteractions.ts to pick back up. `label`
// is already-escaped HTML (it comes from the inline renderer).
function blockedLink(label: string): string {
  return `<span class="link-blocked" title="Blocked link (unsupported URL scheme)">${label}</span>`;
}

// Same path data as components/icons.tsx's IconCopy/IconCheck — duplicated
// as a raw string because this HTML is injected via dangerouslySetInnerHTML,
// not rendered through React, so the components themselves aren't usable
// here. lib/codeCopyButton.ts (the live editor's version of this button)
// keeps its own copy in sync by hand too.
const COPY_BUTTON_ICONS =
  '<svg class="copy-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>' +
  '<svg class="check-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6"></path></svg>';

// CommonMark soft breaks (a single newline inside a paragraph, not two
// trailing spaces or a backslash — those already get their own HardBreak
// node) are just part of the source text. Left as literal "\n", the browser's
// default whitespace handling collapses them to a single space, making
// multi-line paragraphs render as one run-on line. Obsidian (and most note
// apps) render these as visible line breaks by default, so gap text between
// inline nodes converts them to <br> to match.
function textToHtml(s: string): string {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

function children(node: SyntaxNode): SyntaxNode[] {
  const list: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) list.push(c);
  return list;
}

function isMark(node: SyntaxNode): boolean {
  return node.type.name.endsWith("Mark");
}

// ---- inline content (paragraph/heading/table-cell/list-item text) ----

// @lezer/markdown doesn't emit a node for plain text runs — only "special"
// spans (marks, emphasis, links, code) get their own child nodes. The text
// between/around them is a gap that has to be sliced directly from the
// source, not iterated as a child. Every inline renderer below walks gaps
// this way; treating `children()` alone as "the content" (as an earlier
// version of this file did) silently drops all unformatted text.
function renderInlineRange(
  node: SyntaxNode,
  md: string,
  from: number,
  to: number,
  options: RenderMarkdownOptions
): string {
  let html = "";
  let pos = from;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.to <= from || c.from >= to) continue;
    if (c.from > pos) html += textToHtml(md.slice(pos, c.from));
    if (!isMark(c)) html += renderInlineNode(c, md, options);
    pos = Math.min(c.to, to);
  }
  if (pos < to) html += textToHtml(md.slice(pos, to));
  return html;
}

function renderInlineChildren(node: SyntaxNode, md: string, options: RenderMarkdownOptions): string {
  return renderInlineRange(node, md, node.from, node.to, options);
}

// Same gap-walk as renderInlineRange, but excluding specific child nodes
// (e.g. a ListItem's ListMark/nested-list children) rather than a
// sub-range — used where the "content" isn't a contiguous slice. Matched by
// position, not object identity: SyntaxNode objects from separate
// .firstChild/.nextSibling traversals (as `exclude` here always is, coming
// from an earlier children() call) are fresh wrapper objects each time, so
// `===`/Set.has() against them silently never matches.
function renderInlineExcept(
  node: SyntaxNode,
  md: string,
  exclude: (SyntaxNode | undefined)[],
  options: RenderMarkdownOptions
): string {
  const excludeRanges = exclude
    .filter((n): n is SyntaxNode => !!n)
    .map((n) => `${n.from}:${n.to}`);
  const isExcluded = (c: SyntaxNode) => excludeRanges.includes(`${c.from}:${c.to}`);
  let html = "";
  let pos = node.from;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.from > pos) html += textToHtml(md.slice(pos, c.from));
    if (!isExcluded(c) && !isMark(c)) html += renderInlineNode(c, md, options);
    pos = c.to;
  }
  if (pos < node.to) html += textToHtml(md.slice(pos, node.to));
  return html;
}

function linkParts(
  node: SyntaxNode,
  md: string,
  options: RenderMarkdownOptions
): { text: string; href: string; title: string } {
  let href = "";
  let title = "";
  for (const c of children(node)) {
    if (c.type.name === "URL") href = md.slice(c.from, c.to);
    else if (c.type.name === "LinkTitle") title = md.slice(c.from + 1, c.to - 1);
  }
  const marks = children(node).filter((c) => c.type.name === "LinkMark");
  const openBracket = marks[0];
  const closeBracket = marks[1];
  const text =
    openBracket && closeBracket
      ? renderInlineRange(node, md, openBracket.to, closeBracket.from, options)
      : "";
  return { text, href, title };
}

// Resolved → clickable link carrying the data-* attributes
// markdownPreviewInteractions.ts's click delegation reads. Resolution was
// attempted but failed → visually distinct "broken" span. No resolver
// available at all (Scratchpad/DailyNote have no vault context) → inert,
// styled differently again so it doesn't look like an error.
function renderWikilink(node: SyntaxNode, md: string, options: RenderMarkdownOptions, isEmbed: boolean): string {
  const targetNode = children(node).find((c) => c.type.name === "WikiLinkTarget");
  const aliasNode = children(node).find((c) => c.type.name === "WikiLinkAlias");
  const target = targetNode ? md.slice(targetNode.from, targetNode.to).trim() : "";
  const label = aliasNode ? md.slice(aliasNode.from, aliasNode.to).trim() : target;
  if (!target) return "";

  if (!options.resolveWikilink) {
    return `<span class="wikilink wikilink-unavailable">${escapeHtml(label)}</span>`;
  }
  const resolved = options.resolveWikilink(target);
  if (!resolved) {
    return `<span class="wikilink wikilink-broken" title="Note not found">${escapeHtml(label)}</span>`;
  }
  return `<a class="wikilink${isEmbed ? " wikilink-embed" : ""}" data-wikilink-path="${escapeAttr(resolved.filePath)}" data-wikilink-label="${escapeAttr(resolved.label)}">${escapeHtml(label)}</a>`;
}

function renderInlineNode(node: SyntaxNode, md: string, options: RenderMarkdownOptions): string {
  switch (node.type.name) {
    case "StrongEmphasis":
      return `<strong>${renderInlineChildren(node, md, options)}</strong>`;
    case "Emphasis":
      return `<em>${renderInlineChildren(node, md, options)}</em>`;
    case "Strikethrough":
      return `<del>${renderInlineChildren(node, md, options)}</del>`;
    case "Highlight":
      return `<mark>${renderInlineChildren(node, md, options)}</mark>`;
    case "InlineCode": {
      const marks = children(node).filter(isMark);
      const from = marks[0] ? marks[0].to : node.from + 1;
      const to = marks[1] ? marks[1].from : node.to - 1;
      return `<code>${escapeHtml(md.slice(from, to))}</code>`;
    }
    case "Link": {
      const { text, href, title } = linkParts(node, md, options);
      const safe = safeUrl(href);
      if (safe === null) return blockedLink(text);
      return `<a href="${escapeAttr(safe)}"${title ? ` title="${escapeAttr(title)}"` : ""}>${text}</a>`;
    }
    case "Image": {
      const { text, href, title } = linkParts(node, md, options);
      const alt = text.replace(/<[^>]*>/g, "");
      const safe = safeUrl(href);
      if (safe === null) return blockedLink(escapeHtml(alt));
      return `<img src="${escapeAttr(safe)}" alt="${escapeAttr(alt)}"${title ? ` title="${escapeAttr(title)}"` : ""}>`;
    }
    case "WikiLink":
      return renderWikilink(node, md, options, false);
    case "WikiEmbed":
      return renderWikilink(node, md, options, true);
    case "Autolink": {
      const url = md.slice(node.from, node.to).replace(/^<|>$/g, "");
      const safe = safeUrl(url);
      if (safe === null) return blockedLink(escapeHtml(url));
      return `<a href="${escapeAttr(safe)}">${escapeHtml(url)}</a>`;
    }
    // A bare URL — "https://x.com" pasted into a paragraph, or GFM-linkified
    // "www.x.com"/"a@b.com". @lezer/markdown emits these as a standalone URL
    // node with no wrapper (unlike <...>, which gets an Autolink), so
    // without this case they fell through to `default` and rendered as plain
    // text — inconsistent with the editor, which follows them on Mod+click
    // (see lib/linkDestination.ts, which shares the normalization).
    case "URL": {
      const raw = md.slice(node.from, node.to);
      const safe = safeUrl(normalizeBareUrl(raw));
      if (safe === null) return blockedLink(escapeHtml(raw));
      return `<a href="${escapeAttr(safe)}">${escapeHtml(raw)}</a>`;
    }
    case "HardBreak":
      return "<br>";
    case "Entity":
      return md.slice(node.from, node.to);
    case "Escape":
      return escapeHtml(md.slice(node.to - 1, node.to));
    default:
      if (node.firstChild) return renderInlineChildren(node, md, options);
      return textToHtml(md.slice(node.from, node.to));
  }
}

// ---- block content ----

function taskCheckbox(taskMarker: SyntaxNode, md: string, options: RenderMarkdownOptions): string {
  const raw = md.slice(taskMarker.from, taskMarker.to);
  const checked = /\[[xX]\]/.test(raw);
  const disabled = options.interactiveTasks ? "" : " disabled";
  return `<input type="checkbox"${checked ? " checked" : ""}${disabled} data-task-from="${taskMarker.from}" data-task-to="${taskMarker.to}">`;
}

// A list item's "own" content is rendered inline (unwrapped, no <p>) so
// tight lists — the norm for hand-written notes — don't get extra paragraph
// spacing; a nested list is block-rendered underneath as a child <ul>/<ol>.
// Task items (checkboxes) have a different tree shape than plain items —
// `ListItem > Task > [TaskMarker, ...inline content directly, no Paragraph]`
// — so they're handled as their own case rather than falling through to the
// Paragraph-based path below, which a tight non-task item may also skip
// (its inline content sits directly on the ListItem instead).
function renderListItem(node: SyntaxNode, md: string, options: RenderMarkdownOptions): string {
  const kids = children(node);
  const listMark = kids.find((c) => c.type.name === "ListMark");
  const task = kids.find((c) => c.type.name === "Task");
  const paragraph = kids.find((c) => c.type.name === "Paragraph");
  const blockChildren = kids.filter((c) => c !== listMark && c !== task && c !== paragraph && !isMark(c));
  const nested = blockChildren.map((c) => renderBlockNode(c, md, options)).join("");

  if (task) {
    const taskMarker = children(task).find((c) => c.type.name === "TaskMarker");
    const checked = taskMarker ? /\[[xX]\]/.test(md.slice(taskMarker.from, taskMarker.to)) : false;
    const checkbox = taskMarker ? taskCheckbox(taskMarker, md, options) : "";
    const inline = renderInlineExcept(task, md, [taskMarker], options);
    return `<li class="task-item${checked ? " task-done" : ""}">${checkbox}${inline}${nested}</li>`;
  }

  const inline = paragraph
    ? renderInlineChildren(paragraph, md, options)
    : renderInlineExcept(node, md, [listMark, ...blockChildren], options);
  return `<li>${inline}${nested}</li>`;
}

function orderedListStart(node: SyntaxNode, md: string): number {
  const firstItem = children(node).find((c) => c.type.name === "ListItem");
  const mark = firstItem && children(firstItem).find((c) => c.type.name === "ListMark");
  if (!mark) return 1;
  const match = md.slice(mark.from, mark.to).match(/^(\d+)/);
  return match ? Number(match[1]) : 1;
}

function renderTableRow(
  node: SyntaxNode,
  md: string,
  cellTag: "th" | "td",
  options: RenderMarkdownOptions
): string {
  const cells = children(node)
    .filter((c) => c.type.name === "TableCell")
    .map((c) => `<${cellTag}>${renderInlineChildren(c, md, options)}</${cellTag}>`)
    .join("");
  return `<tr>${cells}</tr>`;
}

function renderHeading(
  node: SyntaxNode,
  md: string,
  level: 1 | 2 | 3 | 4 | 5 | 6,
  options: RenderMarkdownOptions
): string {
  // The space between "#" and the heading text (mandatory ATX syntax) is
  // part of the gap between HeaderMark and the text content, so it'd
  // otherwise show up as a leading space in the rendered content.
  return `<h${level}>${renderInlineChildren(node, md, options).trimStart()}</h${level}>`;
}

function renderBlockNode(node: SyntaxNode, md: string, options: RenderMarkdownOptions): string {
  switch (node.type.name) {
    case "ATXHeading1":
    case "SetextHeading1":
      return renderHeading(node, md, 1, options);
    case "ATXHeading2":
    case "SetextHeading2":
      return renderHeading(node, md, 2, options);
    case "ATXHeading3":
      return renderHeading(node, md, 3, options);
    case "ATXHeading4":
      return renderHeading(node, md, 4, options);
    case "ATXHeading5":
      return renderHeading(node, md, 5, options);
    case "ATXHeading6":
      return renderHeading(node, md, 6, options);
    case "Paragraph":
      return `<p>${renderInlineChildren(node, md, options)}</p>`;
    case "Blockquote":
      return `<blockquote>${children(node)
        .filter((c) => !isMark(c))
        .map((c) => renderBlockNode(c, md, options))
        .join("")}</blockquote>`;
    case "HorizontalRule":
      return "<hr>";
    case "BulletList": {
      const items = children(node)
        .filter((c) => c.type.name === "ListItem")
        .map((c) => renderListItem(c, md, options))
        .join("");
      return `<ul>${items}</ul>`;
    }
    case "OrderedList": {
      const start = orderedListStart(node, md);
      const items = children(node)
        .filter((c) => c.type.name === "ListItem")
        .map((c) => renderListItem(c, md, options))
        .join("");
      return `<ol${start !== 1 ? ` start="${start}"` : ""}>${items}</ol>`;
    }
    case "FencedCode": {
      const info = children(node).find((c) => c.type.name === "CodeInfo");
      const text = children(node).find((c) => c.type.name === "CodeText");
      const lang = info ? md.slice(info.from, info.to).trim() : "";
      const code = text ? md.slice(text.from, text.to) : "";
      // The raw, unhighlighted code lives in data-copy-code (not read from
      // .textContent) so copying isn't at the mercy of whatever markup
      // highlightFencedCode happened to wrap each token in. Two icons ship
      // inline and CSS toggles between them on click (see .code-copy-btn.copied
      // in styles.css) rather than swapping innerHTML, so there's no risk of
      // the click handler's copy landing on already-mutated icon markup.
      return `<pre data-lang="${escapeAttr(lang)}"><button type="button" class="code-copy-btn" data-copy-code="${escapeAttr(code)}" title="Copy code" aria-label="Copy code">${COPY_BUTTON_ICONS}</button><code>${highlightFencedCode(code, lang)}</code></pre>`;
    }
    case "CodeBlock": {
      const code = md.slice(node.from, node.to);
      return `<pre data-lang=""><code>${escapeHtml(code)}</code></pre>`;
    }
    case "Table": {
      const rows = children(node);
      const header = rows.find((r) => r.type.name === "TableHeader");
      const body = rows.filter((r) => r.type.name === "TableRow");
      const thead = header ? `<thead>${renderTableRow(header, md, "th", options)}</thead>` : "";
      const tbody = body.length
        ? `<tbody>${body.map((r) => renderTableRow(r, md, "td", options)).join("")}</tbody>`
        : "";
      return `<table>${thead}${tbody}</table>`;
    }
    default:
      if (node.firstChild) {
        return children(node)
          .map((c) => renderBlockNode(c, md, options))
          .join("");
      }
      if (node.from === node.to) return "";
      return `<p>${textToHtml(md.slice(node.from, node.to))}</p>`;
  }
}

// Rendered as a native <details> — collapsible for free, no click-handler
// wiring needed in the static preview (unlike the editor's fold, which does
// need one; see frontmatterFold.ts). Reuses the same markup shape as a
// fenced code block (<pre data-lang=""><code>) purely to pick up its
// existing .note styling without adding a dedicated CSS rule for the box.
function renderFrontmatterHtml(yaml: string): string {
  const count = countFrontmatterProperties(yaml);
  const label = count > 0 ? `${count} propert${count === 1 ? "y" : "ies"}` : "Frontmatter";
  return `<details class="frontmatter" open><summary>${escapeHtml(label)}</summary><pre data-lang=""><code>${escapeHtml(yaml)}</code></pre></details>`;
}

export function renderMarkdown(md: string, options: RenderMarkdownOptions = {}): string {
  // Parsing the *whole* string (rather than slicing the frontmatter off
  // first) keeps every other node's .from/.to absolute-correct against the
  // original source — task checkboxes embed those offsets as data-task-from/
  // to for in-place toggling, and a shifted parse would silently corrupt
  // them for any note with frontmatter. The CommonMark parser doesn't know
  // "---" delimiters are special, so it still emits (wrong) nodes for that
  // span — a HorizontalRule for the opening line, then usually a
  // SetextHeading for whatever follows up to the closing line. Skipping
  // every top-level node that starts before the frontmatter's end discards
  // exactly those misparsed nodes, whatever shape they turned out to be, by
  // position rather than by guessing their node type.
  const fm = splitFrontmatter(md);
  const tree: Tree = parser.parse(md);
  const html = children(tree.topNode)
    .filter((c) => !fm || c.from >= fm.to)
    .map((c) => renderBlockNode(c, md, options))
    .join("");
  const body = html || '<p class="muted">Note is empty.</p>';
  const includeFrontmatter = options.includeFrontmatter ?? true;
  return fm && includeFrontmatter ? renderFrontmatterHtml(fm.yaml) + body : body;
}
