import { describe, expect, it } from "vitest";
import type { AssistantChatSummary } from "../../../shared/types";
import { nestBranches } from "./chatBranches";

const chat = (id: string, parentId: string | null = null): AssistantChatSummary => ({
  id,
  title: id,
  pinned: false,
  updatedAt: 0,
  folderId: null,
  parentId,
});

describe("nestBranches", () => {
  it("puts a branch under its parent, nested by depth", () => {
    const out = nestBranches([chat("b", "a"), chat("x"), chat("a"), chat("c", "b")]);
    expect(out.map((r) => `${r.chat.id}:${r.depth}`)).toEqual(["x:0", "a:0", "b:1", "c:2"]);
  });

  it("leaves a branch in place when its parent isn't in the group", () => {
    const out = nestBranches([chat("b", "gone"), chat("x")]);
    expect(out.map((r) => `${r.chat.id}:${r.depth}`)).toEqual(["b:0", "x:0"]);
  });

  it("never drops a chat in a cycle", () => {
    expect(nestBranches([chat("a", "b"), chat("b", "a")])).toHaveLength(2);
  });
});
