// Flipping a task checkbox from the rendered preview.
//
// `from`/`to` are source offsets of the "[ ]"/"[x]" marker itself, carried
// through the rendered HTML as data-task-from/data-task-to by lib/markdown.ts
// and read back by lib/markdownPreviewInteractions.ts. Splicing by offset
// rather than searching the text is what keeps the right checkbox getting
// toggled in a note with many identical-looking task lines.

export function toggleTaskAt(
  content: string,
  from: number,
  to: number,
  checked: boolean
): string {
  return content.slice(0, from) + (checked ? "[x]" : "[ ]") + content.slice(to);
}
