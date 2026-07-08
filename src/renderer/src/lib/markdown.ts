// A tiny markdown renderer — just enough for headings, bullets, and tasks.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)/);
    const task = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/);
    const bullet = line.match(/^\s*[-*]\s+(.*)/);

    if (h) {
      if (inList) (html += "</ul>"), (inList = false);
      html += `<h3>${escapeHtml(h[2])}</h3>`;
    } else if (task) {
      if (!inList) (html += "<ul>"), (inList = true);
      const done = task[1] === "x";
      html += `<li class="${done ? "task-done" : ""}">${
        done ? "✓" : "○"
      } ${escapeHtml(task[2])}</li>`;
    } else if (bullet) {
      if (!inList) (html += "<ul>"), (inList = true);
      html += `<li>${escapeHtml(bullet[1])}</li>`;
    } else {
      if (inList) (html += "</ul>"), (inList = false);
      if (line.trim()) html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html || '<p class="muted">Note is empty.</p>';
}
