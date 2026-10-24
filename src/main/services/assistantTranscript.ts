// Pure helpers over the Assistant's stored message history: no Electron, no
// DB, no network, so they can be tested directly. The history itself is the
// OpenAI-style message list services/assistant.ts keeps; this file turns it
// back into something a UI can show (a resumed chat has no other source of
// truth for what was said, so the display is derived rather than stored twice).

import type { AssistantAttachment, AssistantToolCall, AssistantTranscriptItem } from "../../shared/types";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// `archived` marks a message that compaction folded into a summary: it stays in
// the stored history (the transcript and search still show it) but is never
// sent to the model. `summary` marks the system message holding that summary.
// Neither flag may reach the provider; assistantCompaction.ts's `toWire`
// strips them.
// What goes over the wire: like ChatMessage, but a user message holding images
// carries its content as parts (the OpenAI shape OpenRouter accepts).
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ChatMessage =
  | {
      role: "system" | "user";
      content: string;
      archived?: boolean;
      summary?: boolean;
      // A user message that started a slash command: the command's name, and the
      // instructions put in front of `content` when it is sent to the model.
      // `content` stays exactly what the user typed (that is what the
      // transcript, titles and search show).
      command?: string;
      injected?: string;
      // Files attached to a user message. Only images and small text files are
      // accepted (assistantAttachments.ts); see `toWire` for how they are sent.
      attachments?: AssistantAttachment[];
    }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; archived?: boolean }
  | { role: "tool"; tool_call_id: string; content: string; archived?: boolean };

const MAX_FACT_CHARS = 500;
const MAX_ARGS_CHARS = 160;
const MAX_RESULT_CHARS = 1200;

// The error a tool reports when the user says no to its confirmation card.
// Shared so the loop that produces it and the transcript that recognises it
// can't drift apart.
export const DECLINED_MESSAGE = "The user declined this action";
const MAX_TITLE_CHARS = 60;

// One definition of how a remembered fact is normalised, shared by the tool
// that writes it and the transcript that re-displays it, so a chip never reads
// differently live than after a reload.
export function cleanFact(fact: string): string {
  return fact.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_CHARS);
}

export function deriveTitle(firstUserMessage: string): string {
  const flat = firstUserMessage.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_TITLE_CHARS) return flat || "New chat";
  return `${flat.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
}

// Turns a model's raw reply to "write a title" into something safe to show in a
// list: one line, no wrapping quotes or markdown, no trailing punctuation, no
// reasoning preamble. Returns null when nothing usable is left, so the caller
// keeps the placeholder title rather than showing an empty row.
export function cleanTitle(raw: string): string | null {
  // Some reasoning models emit their thinking inline; the answer follows it.
  const answer = raw.includes("</think>") ? raw.split("</think>").pop()! : raw;
  const firstLine = answer.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  let title = firstLine
    .replace(/^title\s*:\s*/i, "")
    .replace(/^[#>*\-\s"'“”‘’`]+/, "")
    .replace(/["'“”‘’`*]+$/, "")
    .replace(/[.:;,!\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  if (title.length > MAX_TITLE_CHARS) title = `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  return title;
}

function errorOf(content: string): string | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return typeof parsed.error === "string" ? parsed.error : "The tool reported an error";
    }
  } catch {
    // Not JSON: not an error payload.
  }
  return null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// "key: value, key: value" for the tool log — enough to see what the model
// asked for without dumping raw JSON. Bounded: it ends up in a list row.
export function summarizeArguments(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return clip(raw.replace(/\s+/g, " ").trim(), MAX_ARGS_CHARS);
  }
  if (!parsed || typeof parsed !== "object") return "";
  const pairs = Object.entries(parsed as Record<string, unknown>).map(
    ([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`
  );
  return clip(pairs.join(", ").replace(/\s+/g, " ").trim(), MAX_ARGS_CHARS);
}

// What the UI shows for one tool call, from the call and the result the model
// was given. Used both when a reply is produced and when a saved chat is
// reopened, which is what keeps the two identical. A call with no recorded
// result counts as failed.
export function describeToolCall(call: ToolCall, result: string | undefined): AssistantToolCall {
  const error = result === undefined ? "No result was recorded" : errorOf(result);
  const failed = error !== null;
  const args = summarizeArguments(call.function.arguments ?? "");
  return {
    name: call.function.name,
    ok: !failed,
    ...(error === DECLINED_MESSAGE ? { declined: true } : {}),
    ...(args ? { args } : {}),
    result: failed ? error : clip(result ?? "", MAX_RESULT_CHARS),
  };
}

function factFromArguments(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.fact === "string" ? cleanFact(parsed.fact) : null;
  } catch {
    return null;
  }
}

// One assistant item per user turn, however many model steps it took: the
// live reply is the text of every step joined by a blank line, with the tool
// chips of all of them, so that is rebuilt here. `system` and `tool` messages
// never appear — they are plumbing.
export function toTranscript(messages: ChatMessage[]): AssistantTranscriptItem[] {
  const toolResults = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "tool") toolResults.set(m.tool_call_id, m.content);
  }

  const items: AssistantTranscriptItem[] = [];
  let current: AssistantTranscriptItem | null = null;

  for (const m of messages) {
    if (m.role === "user") {
      items.push({
        role: "user",
        text: m.content,
        ...(m.command ? { command: m.command } : {}),
        ...(m.attachments?.length
          ? {
              attachments: m.attachments.map(({ id, name, mime, kind, size }) => ({ id, name, mime, kind, size })),
            }
          : {}),
        toolCalls: [],
        remembered: [],
      });
      current = null;
      continue;
    }
    if (m.role === "system" && m.summary) {
      items.push({ role: "summary", text: m.content, toolCalls: [], remembered: [] });
      current = null;
      continue;
    }
    if (m.role !== "assistant") continue;

    if (!current) {
      current = { role: "assistant", text: "", toolCalls: [], remembered: [] };
      items.push(current);
    }
    const text = m.content?.trim();
    if (text) current.text += (current.text ? "\n\n" : "") + text;

    for (const call of m.tool_calls ?? []) {
      const described = describeToolCall(call, toolResults.get(call.id));
      current.toolCalls.push(described);
      if (described.ok && call.function.name === "remember") {
        const fact = factFromArguments(call.function.arguments);
        if (fact) current.remembered.push(fact);
      }
    }
  }
  return items;
}
