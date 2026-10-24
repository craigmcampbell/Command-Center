// Turns Assistant replies into markdown for "Save to notes". Pure, so the shape
// of what lands in a daily note is tested rather than eyeballed.

export interface ExportItem {
  role: "user" | "assistant" | "error";
  text: string;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// One reply, labelled with the question that prompted it so the note makes
// sense on its own a month later.
export function replyToMarkdown(question: string | null, answer: string): string {
  const header = question
    ? `Asked the assistant: “${clip(question, 100)}”`
    : "From the assistant:";
  return `${header}\n\n${answer.trim()}`;
}

// A whole conversation. Errors are not part of the conversation worth keeping.
export function chatToMarkdown(title: string | null, items: ExportItem[]): string {
  const turns = items
    .filter((item) => item.role !== "error" && item.text.trim())
    .map((item) => `**${item.role === "user" ? "You" : "Assistant"}:** ${item.text.trim()}`);
  return [`Assistant chat${title ? ` — ${clip(title, 80)}` : ""}`, ...turns].join("\n\n");
}
