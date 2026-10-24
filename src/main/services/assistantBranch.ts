// Editing an earlier question: pure helpers, no Electron, DB or network.
//
// A branch is a NEW chat holding a copy of the original's history up to (not
// including) the edited user message, linked back by `parent_chat_id` +
// `branched_at_seq`. The original is never touched. Copying rather than a
// message tree keeps `toWire`, compaction, search and `saveChat`'s whole-chat
// rewrite exactly as they are.
//
// Rules:
//  - The cut is always at a user message, so an assistant `tool_calls` message
//    keeps every one of its results. A prefix with a call lacking its result is
//    refused anyway (defence against a malformed stored chat).
//  - If the edited message is still live, the copied `archived`/`summary` flags
//    stay valid: the latest summary sits before the first live user message and
//    covers only what precedes it.
//  - If the edited message was ARCHIVED (folded into a summary), every summary in
//    the prefix describes a history the branch doesn't share in the same shape,
//    and the one covering the cut is after it. The branch is rebuilt
//    UNCOMPACTED: summaries dropped, `archived` cleared. A later turn
//    re-compacts it if it is too large.
//  - Copied tool calls are history only; nothing is re-run.

import type { AssistantAttachment } from "../../shared/types";
import type { ChatMessage } from "./assistantTranscript";

export type UserMessage = Extract<ChatMessage, { role: "system" | "user" }>;

export type BranchPlan =
  | {
      ok: true;
      // Stored-list index (= `seq`) of the edited user message in the parent.
      seq: number;
      // The branch's history before the edited question.
      prefix: ChatMessage[];
      // The original question, for its command and attachments.
      original: UserMessage;
      // True when the prefix was rebuilt without its summaries.
      uncompacted: boolean;
    }
  | { ok: false; reason: string };

// `turn` is the 0-based index among the chat's user messages (archived ones
// included), which is the order the transcript shows them in.
export function planBranch(messages: ChatMessage[], turn: number): BranchPlan {
  if (!Number.isInteger(turn) || turn < 0) return { ok: false, reason: "That message can't be edited" };
  let seen = -1;
  const seq = messages.findIndex((m) => m.role === "user" && ++seen === turn);
  if (seq < 0) return { ok: false, reason: "That message no longer exists" };
  const original = messages[seq] as UserMessage;
  const uncompacted = original.archived === true;
  const copied = messages.slice(0, seq);
  const prefix = uncompacted
    ? copied
        .filter((m) => !(m.role === "system" && m.summary))
        .map((m) => {
          const { archived: _archived, ...rest } = m as ChatMessage & { archived?: boolean };
          return rest as ChatMessage;
        })
    : copied;

  const answered = new Set(prefix.flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : [])));
  for (const m of prefix) {
    if (m.role === "assistant" && (m.tool_calls ?? []).some((c) => !answered.has(c.id))) {
      return { ok: false, reason: "Can't branch there: a tool call before it has no result" };
    }
  }
  return { ok: true, seq, prefix, original, uncompacted };
}

// The original question's attachments the user kept, by id. Ids not on the
// original are ignored: main never takes a file reference from the renderer it
// didn't already store for this message.
export function keptAttachments(original: UserMessage, keepIds: unknown): AssistantAttachment[] {
  const keep = new Set(Array.isArray(keepIds) ? keepIds.filter((id): id is string => typeof id === "string") : []);
  return (original.attachments ?? []).filter((a) => keep.has(a.id));
}

export function branchTitle(parentTitle: string): string {
  return `${parentTitle} (branch)`.slice(0, 120);
}
