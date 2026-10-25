import type { AssistantChatSummary } from "../../../shared/types";

// Orders one history group so each branch sits right under the chat it was
// branched from (and a branch of a branch under that), keeping the group's own
// order otherwise. A branch whose parent isn't in this group (another folder, a
// search that didn't match it, or a deleted parent) stays where the list put it.
export function nestBranches(chats: AssistantChatSummary[]): { chat: AssistantChatSummary; depth: number }[] {
  const ids = new Set(chats.map((c) => c.id));
  const children = new Map<string, AssistantChatSummary[]>();
  const roots: AssistantChatSummary[] = [];
  for (const c of chats) {
    if (c.parentId && c.parentId !== c.id && ids.has(c.parentId)) {
      children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
    } else {
      roots.push(c);
    }
  }
  const out: { chat: AssistantChatSummary; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (c: AssistantChatSummary, depth: number): void => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push({ chat: c, depth });
    for (const child of children.get(c.id) ?? []) visit(child, depth + 1);
  };
  for (const c of roots) visit(c, 0);
  // A parent cycle can't be made through the app; never drop a chat over one.
  for (const c of chats) visit(c, 0);
  return out;
}
