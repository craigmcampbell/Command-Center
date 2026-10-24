import { describe, expect, it } from "vitest";
import { branchTitle, keptAttachments, planBranch, type UserMessage } from "./assistantBranch";
import { toWire } from "./assistantCompaction";
import type { ChatMessage } from "./assistantTranscript";

const call = (id: string) => ({ id, type: "function" as const, function: { name: "complete_task", arguments: "{}" } });

const chat: ChatMessage[] = [
  { role: "user", content: "q0" },
  { role: "assistant", content: null, tool_calls: [call("c1")] },
  { role: "tool", tool_call_id: "c1", content: "{}" },
  { role: "assistant", content: "a0" },
  { role: "user", content: "q1" },
  { role: "assistant", content: "a1" },
];

describe("planBranch", () => {
  it("cuts just before the edited user message, keeping tool calls whole", () => {
    const plan = planBranch(chat, 1);
    expect(plan.ok && plan.seq).toBe(4);
    expect(plan.ok && plan.prefix).toEqual(chat.slice(0, 4));
    expect(plan.ok && plan.uncompacted).toBe(false);
  });

  it("branching from the first question copies nothing", () => {
    const plan = planBranch(chat, 0);
    expect(plan.ok && plan.prefix).toEqual([]);
  });

  it("refuses unknown turns and a call without its result", () => {
    expect(planBranch(chat, 2).ok).toBe(false);
    expect(planBranch(chat, -1).ok).toBe(false);
    const broken: ChatMessage[] = [chat[0], chat[1], { role: "user", content: "q1" }];
    expect(planBranch(broken, 1).ok).toBe(false);
  });

  it("keeps compaction flags when the cut is in the live part", () => {
    const compacted: ChatMessage[] = [
      { role: "user", content: "q0", archived: true },
      { role: "assistant", content: "a0", archived: true },
      { role: "system", content: "summary of q0", summary: true },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ];
    const plan = planBranch(compacted, 2);
    expect(plan.ok && plan.prefix).toEqual(compacted.slice(0, 5));
    const wire = toWire([{ role: "system", content: "sys" }, ...(plan.ok ? plan.prefix : [])]);
    expect(wire[0].content).toContain("summary of q0");
  });

  it("rebuilds uncompacted when the cut falls inside the summarized part", () => {
    const compacted: ChatMessage[] = [
      { role: "user", content: "q0", archived: true },
      { role: "assistant", content: "a0", archived: true },
      { role: "user", content: "q1", archived: true },
      { role: "assistant", content: "a1", archived: true },
      { role: "system", content: "summary", summary: true },
      { role: "user", content: "q2" },
    ];
    const plan = planBranch(compacted, 1);
    expect(plan.ok && plan.uncompacted).toBe(true);
    expect(plan.ok && plan.prefix).toEqual([
      { role: "user", content: "q0" },
      { role: "assistant", content: "a0" },
    ]);
    const wire = toWire([{ role: "system", content: "sys" }, ...(plan.ok ? plan.prefix : [])]);
    expect(wire.map((m) => m.content)).toEqual(["sys", "q0", "a0"]);
  });
});

describe("keptAttachments", () => {
  const original: UserMessage = {
    role: "user",
    content: "q",
    attachments: [
      { id: "a".repeat(64), name: "a.png", mime: "image/png", kind: "image", size: 1 },
      { id: "b".repeat(64), name: "b.txt", mime: "text/plain", kind: "text", size: 1, text: "hi" },
    ],
  };
  it("keeps only ids the original message had", () => {
    expect(keptAttachments(original, ["b".repeat(64), "c".repeat(64), 5]).map((a) => a.name)).toEqual(["b.txt"]);
    expect(keptAttachments(original, "nope")).toEqual([]);
  });
});

it("titles a branch after its parent", () => {
  expect(branchTitle("Trip plans")).toBe("Trip plans (branch)");
});
