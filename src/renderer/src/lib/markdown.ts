// A tiny markdown renderer — just enough for headings, nested bullets/tasks,
// and inline bold/italic/code.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// Inline formatting, applied after escaping: code spans first (so their
// contents aren't further interpreted as bold/italic), then bold, then
// italic. Simple sequential regex passes — not a full CommonMark parser,
// just enough for notes typed by hand.
function renderInline(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  html = html.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`);
  html = html.replace(/\*([^*]+)\*|_([^_]+)_/g, (_, a, b) => `<em>${a ?? b}</em>`);
  return html;
}

interface ListItem {
  indent: number;
  className: string;
  html: string;
}

interface ListNode {
  className: string;
  html: string;
  children: ListNode[];
}

// Builds a nested <ul> tree from a flat list of items keyed by indent depth,
// via a stack of open ancestors — pop back to the nearest shallower (or
// equal) indent, then push the new item as a child of whatever's left.
function renderListTree(items: ListItem[]): string {
  const root: ListNode = { className: "", html: "", children: [] };
  const stack: { indent: number; node: ListNode }[] = [{ indent: -1, node: root }];

  for (const item of items) {
    while (stack.length > 1 && item.indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const node: ListNode = { className: item.className, html: item.html, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent: item.indent, node });
  }

  function renderChildren(node: ListNode): string {
    if (node.children.length === 0) return "";
    const items = node.children
      .map((child) => `<li class="${child.className}">${child.html}${renderChildren(child)}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }

  return renderChildren(root);
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  let html = "";
  let listItems: ListItem[] = [];

  function flushList() {
    if (listItems.length > 0) {
      html += renderListTree(listItems);
      listItems = [];
    }
  }

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)/);
    const task = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
    const bullet = line.match(/^(\s*)[-*]\s+(.*)/);

    if (h) {
      flushList();
      html += `<h3>${renderInline(h[2])}</h3>`;
    } else if (task) {
      const done = task[2].toLowerCase() === "x";
      listItems.push({
        indent: task[1].length,
        className: done ? "task-done" : "",
        html: `${done ? "✓" : "○"} ${renderInline(task[3])}`,
      });
    } else if (bullet) {
      listItems.push({ indent: bullet[1].length, className: "", html: renderInline(bullet[2]) });
    } else {
      flushList();
      if (line.trim()) html += `<p>${renderInline(line)}</p>`;
    }
  }
  flushList();
  return html || '<p class="muted">Note is empty.</p>';
}
