import { describe, expect, it } from "vitest";
import {
  applyCompaction,
  buildSummaryInput,
  cleanSummary,
  estimateTokens,
  KEEP_RECENT_TURNS,
  planCompaction,
  toWire,
} from "./assistantCompaction";
import { searchTextOf } from "./assistantChats";
import { toTranscript, type ChatMessage } from "./assistantTranscript";

const call = (id: string, name = "get_due_tasks") => ({
  id,
  type: "function" as const,
  function: { name, arguments: "{}" },
});

// `n` user turns, each: question, a tool-calling step with a bulky result, answer.
function chat(n: number, resultSize = 3000): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: "SYSTEM PROMPT" }];
  for (let i = 1; i <= n; i++) {
    out.push(
      { role: "user", content: `question ${i}` },
      { role: "assistant", content: null, tool_calls: [call(`c${i}`)] },
      { role: "tool", tool_call_id: `c${i}`, content: "x".repeat(resultSize) },
      { role: "assistant", content: `answer ${i}` }
    );
  }
  return out;
}

describe("planCompaction", () => {
  it("does nothing until there are more turns than the recent window", () => {
    expect(planCompaction(chat(KEEP_RECENT_TURNS))).toBeNull();
    expect(planCompaction(chat(KEEP_RECENT_TURNS + 1))).not.toBeNull();
  });

  it("cuts on a user message, so a tool call never loses its result", () => {
    const messages = chat(6);
    const plan = planCompaction(messages)!;
    expect(messages[plan.end]).toEqual({ role: "user", content: "question 3" });
    expect(plan.indices).toEqual(Array.from({ length: plan.end - 1 }, (_, i) => i + 1));
    expect(plan.indices).not.toContain(0); // the system prompt is never summarized
  });

  it("folds an earlier summary into the next one", () => {
    const first = applyCompaction(chat(6), planCompaction(chat(6))!, "first summary text, long enough");
    const more = [...first, ...chat(3).slice(1)];
    const plan = planCompaction(more)!;
    const input = buildSummaryInput(more, plan);
    expect(input).toContain("first summary text, long enough");
    const next = applyCompaction(more, plan, "second summary text, long enough");
    expect(next.filter((m) => m.role === "system" && m.summary && !m.archived)).toHaveLength(1);
  });

  it("returns null when the only old thing is a summary", () => {
    const summarized = applyCompaction(chat(6), planCompaction(chat(6))!, "a summary that is long enough");
    expect(planCompaction(summarized)).toBeNull();
  });
});

describe("toWire", () => {
  it("is the history unchanged when nothing is archived", () => {
    const messages = chat(2, 100);
    expect(toWire(messages)).toEqual(messages);
  });

  it("hides archived messages and puts the summary in the system prompt", () => {
    const messages = chat(6, 100);
    const compacted = applyCompaction(messages, planCompaction(messages)!, "THE SUMMARY text goes here");
    const wire = toWire(compacted);
    expect(wire[0].role).toBe("system");
    expect(wire[0].content).toContain("SYSTEM PROMPT");
    expect(wire[0].content).toContain("THE SUMMARY text goes here");
    expect(wire.filter((m) => m.role === "system")).toHaveLength(1);
    expect(wire.find((m) => m.role === "user")).toMatchObject({ content: "question 3" });
    expect(JSON.stringify(wire)).not.toContain("question 2");
    expect(JSON.stringify(wire)).not.toContain("archived");
    expect(JSON.stringify(wire)).not.toContain('"summary":');
  });

  it("never splits a tool call from its result", () => {
    const messages = chat(7, 100);
    const wire = toWire(applyCompaction(messages, planCompaction(messages)!, "summary text long enough"));
    const callIds = wire.flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []).map((c) => c.id) : []));
    const resultIds = wire.flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : []));
    expect(resultIds).toEqual(callIds);
  });

  it("trims bulky tool output from old turns but not from the recent ones", () => {
    const wire = toWire(chat(6));
    const results = wire.filter((m) => m.role === "tool").map((m) => m.content);
    expect(results).toHaveLength(6);
    expect(results[0]).toContain("older tool output trimmed: 3000 characters");
    expect(results[0].length).toBeLessThan(600);
    expect(results[5]).toBe("x".repeat(3000));
    // The stored history is untouched.
    const messages = chat(6);
    toWire(messages);
    expect(messages.find((m) => m.role === "tool")).toMatchObject({ content: "x".repeat(3000) });
  });
});

describe("applyCompaction", () => {
  it("archives instead of deleting, and does not modify its input", () => {
    const messages = chat(6, 50);
    const before = JSON.stringify(messages);
    const plan = planCompaction(messages)!;
    const next = applyCompaction(messages, plan, "a summary that is long enough");
    expect(JSON.stringify(messages)).toBe(before);
    expect(next).toHaveLength(messages.length + 1);
    expect(next[plan.end]).toEqual({ role: "system", content: "a summary that is long enough", summary: true });
    expect(next.filter((m) => m.archived)).toHaveLength(plan.indices.length);
    expect(next[0].archived).toBeUndefined();
  });

  it("keeps the whole conversation in the transcript, with a divider", () => {
    const messages = chat(6, 50);
    const next = applyCompaction(messages, planCompaction(messages)!, "a summary that is long enough");
    const items = toTranscript(next);
    expect(items.filter((i) => i.role === "user")).toHaveLength(6);
    const divider = items.findIndex((i) => i.role === "summary");
    expect(items[divider].text).toBe("a summary that is long enough");
    expect(items[divider + 1]).toMatchObject({ role: "user", text: "question 3" });
  });

  it("does not make the summary or archived tool output searchable", () => {
    const messages = chat(6, 50);
    const next = applyCompaction(messages, planCompaction(messages)!, "a secretsummaryword goes here");
    expect(searchTextOf(next)).not.toContain("secretsummaryword");
    expect(searchTextOf(next)).toContain("question 1");
  });
});

describe("buildSummaryInput", () => {
  it("clips tool output and, when too long, drops the oldest lines", () => {
    const messages = chat(6, 5000);
    const input = buildSummaryInput(messages, planCompaction(messages)!);
    expect(input).toContain("User: question 1");
    expect(input).not.toContain("x".repeat(400));

    const huge: ChatMessage[] = [{ role: "system", content: "s" }];
    for (let i = 1; i <= 6; i++) {
      huge.push({ role: "user", content: `q${i} ${"y".repeat(30_000)}` }, { role: "assistant", content: "ok" });
    }
    const big = buildSummaryInput(huge, planCompaction(huge)!);
    expect(big).toContain("left out");
    expect(big).toContain("q2 ");
    expect(big).not.toContain("q1 ");
  });
});

describe("cleanSummary", () => {
  it("strips reasoning and wrapper tags, and refuses empties", () => {
    expect(cleanSummary("<think>hmm</think><summary>The user asked about tasks and decided X.</summary>")).toBe(
      "The user asked about tasks and decided X."
    );
    expect(cleanSummary("  ")).toBeNull();
    expect(cleanSummary("ok")).toBeNull();
    expect(cleanSummary("z".repeat(9000))!.length).toBeLessThanOrEqual(4000);
  });
});

describe("estimateTokens", () => {
  it("grows with content and tool arguments", () => {
    const small = estimateTokens(chat(1, 100));
    expect(estimateTokens(chat(1, 4000))).toBeGreaterThan(small + 900);
    expect(estimateTokens([])).toBe(0);
  });
});

describe("attachments on the wire", () => {
  const img = (id: string, name = `${id}.png`) => ({ id, name, mime: "image/png", kind: "image" as const, size: 10 });
  const resolve = (id: string) => `data:image/png;base64,${id}`;
  const turn = (n: number, attachments?: ReturnType<typeof img>[]): ChatMessage[] => [
    { role: "user", content: `question ${n}`, ...(attachments ? { attachments } : {}) },
    { role: "assistant", content: `answer ${n}` },
  ];
  const sys: ChatMessage = { role: "system", content: "SYS" };

  it("sends an image as a content part after the text", () => {
    const wire = toWire([sys, ...turn(1, [img("a")])], resolve);
    expect(wire[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "question 1" },
        { type: "image_url", image_url: { url: "data:image/png;base64,a" } },
      ],
    });
  });

  it("sends an image with no text as just the image", () => {
    const wire = toWire([sys, { role: "user", content: "", attachments: [img("a")] }], resolve);
    expect(wire[1].content).toEqual([{ type: "image_url", image_url: { url: "data:image/png;base64,a" } }]);
  });

  it("only re-sends images from the most recent turns", () => {
    const messages = [sys, ...turn(1, [img("old")]), ...turn(2), ...turn(3, [img("mid")]), ...turn(4, [img("new")])];
    const wire = toWire(messages, resolve);
    const users = wire.filter((m) => m.role === "user");
    expect(users[0].content).toBe('question 1\n\n[Image "old.png" is no longer attached]');
    expect(Array.isArray(users[2].content)).toBe(true);
    expect(Array.isArray(users[3].content)).toBe(true);
    expect(JSON.stringify(wire)).not.toContain("base64,old");
  });

  it("falls back to a note when the file can't be read", () => {
    const wire = toWire([sys, ...turn(1, [img("gone")])], () => null);
    expect(wire[1].content).toBe('question 1\n\n[Image "gone.png" is no longer attached]');
  });

  it("puts a text file inline as delimited data, after the command and the typed text", () => {
    const wire = toWire(
      [
        sys,
        {
          role: "user",
          content: "summarise this",
          injected: "<command>X</command>",
          attachments: [{ id: "t", name: 'notes "v2".md', mime: "text/markdown", kind: "text", size: 5, text: "Hello", truncated: true }],
        },
      ],
      resolve
    );
    expect(wire[1].content).toBe(
      '<command>X</command>\n\nsummarise this\n\n<attachment name="notes \\"v2\\".md" type="text/markdown">\nHello\n[The rest of the file was cut off.]\n</attachment>'
    );
  });

  it("leaves a chat without attachments exactly as it was", () => {
    const messages = [sys, ...turn(1), ...turn(2)];
    expect(toWire(messages, resolve)).toEqual(messages);
  });

  it("counts images in the size estimate and names files for the summarizer", () => {
    const withImage = toWire([sys, ...turn(1, [img("a")])], resolve);
    const without = toWire([sys, ...turn(1)], resolve);
    expect(estimateTokens(withImage)).toBeGreaterThan(estimateTokens(without) + 900);

    const messages: ChatMessage[] = [sys];
    for (let i = 1; i <= 6; i++) messages.push(...turn(i, i === 1 ? [img("a", "chart.png")] : undefined));
    expect(buildSummaryInput(messages, planCompaction(messages)!)).toContain("User: question 1 [attached: chart.png]");
  });
});
