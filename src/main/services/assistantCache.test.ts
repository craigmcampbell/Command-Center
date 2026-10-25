import { describe, expect, it } from "vitest";
import { needsCacheBreakpoints, withCacheBreakpoints } from "./assistantCache";
import { toWire } from "./assistantCompaction";
import type { ChatMessage, WireMessage } from "./assistantTranscript";

const MARK = { type: "ephemeral" };

const history: WireMessage[] = [
  { role: "system", content: "SYSTEM" },
  { role: "user", content: "first" },
  { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "t", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "a", content: "result" },
  { role: "assistant", content: "answer" },
  { role: "user", content: "second" },
  { role: "assistant", content: "answer 2" },
  { role: "user", content: "third" },
];

function marked(messages: WireMessage[]): number[] {
  return messages.flatMap((m, i) =>
    Array.isArray(m.content) && m.content.some((p) => p.type === "text" && p.cache_control) ? [i] : []
  );
}

describe("needsCacheBreakpoints", () => {
  it("is true only for Anthropic slugs", () => {
    expect(needsCacheBreakpoints("anthropic/claude-sonnet-5.5")).toBe(true);
    expect(needsCacheBreakpoints("~anthropic/claude-sonnet-latest")).toBe(true);
    expect(needsCacheBreakpoints(" Anthropic/claude-opus-5.5 ")).toBe(true);
    for (const slug of ["openai/gpt-5", "deepseek/deepseek-chat", "google/gemini-2.5-pro", "qwen/qwen3-max", "x-anthropic/foo"]) {
      expect(needsCacheBreakpoints(slug)).toBe(false);
    }
  });
});

describe("withCacheBreakpoints", () => {
  it("leaves other providers' requests byte-for-byte unchanged", () => {
    for (const model of ["openai/gpt-5", "google/gemini-2.5-flash", "deepseek/deepseek-chat"]) {
      const out = withCacheBreakpoints(history, model, true);
      expect(out).toBe(history);
      expect(JSON.stringify(out)).not.toContain("cache_control");
    }
  });

  it("does nothing when switched off", () => {
    expect(withCacheBreakpoints(history, "anthropic/claude-sonnet-5.5", false)).toBe(history);
  });

  it("marks the system message and the last two user messages for Anthropic", () => {
    const out = withCacheBreakpoints(history, "anthropic/claude-sonnet-5.5", true);
    expect(marked(out)).toEqual([0, 5, 7]);
    expect(out[0]).toEqual({ role: "system", content: [{ type: "text", text: "SYSTEM", cache_control: MARK }] });
    expect(out[7]).toEqual({ role: "user", content: [{ type: "text", text: "third", cache_control: MARK }] });
    // Everything else is untouched, and the input wasn't modified.
    expect(out.filter((_, i) => ![0, 5, 7].includes(i))).toEqual(history.filter((_, i) => ![0, 5, 7].includes(i)));
    expect(JSON.stringify(history)).not.toContain("cache_control");
  });

  it("stays within Anthropic's four breakpoints", () => {
    const long: WireMessage[] = [history[0]];
    for (let i = 0; i < 20; i++) long.push({ role: "user", content: `q${i}` }, { role: "assistant", content: `a${i}` });
    const out = withCacheBreakpoints(long, "anthropic/claude-opus-5.5", true);
    expect(marked(out).length).toBeLessThanOrEqual(4);
    expect(marked(out)).toEqual([0, 37, 39]);
  });

  it("keeps the newest user turn's breakpoint through the turn's tool steps", () => {
    const mid: WireMessage[] = [
      ...history,
      { role: "assistant", content: null, tool_calls: [{ id: "b", type: "function", function: { name: "t", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "b", content: "result 2" },
    ];
    expect(marked(withCacheBreakpoints(mid, "anthropic/claude-sonnet-5.5", true))).toEqual([0, 5, 7]);
  });

  it("marks the last text part of a message with images, and skips an images-only one", () => {
    const image = { type: "image_url" as const, image_url: { url: "data:image/png;base64,a" } };
    const out = withCacheBreakpoints(
      [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: [image] },
        { role: "assistant", content: "seen" },
        { role: "user", content: [{ type: "text", text: "look" }, image] },
      ],
      "anthropic/claude-sonnet-5.5",
      true
    );
    expect(out[1]).toEqual({ role: "user", content: [image] });
    expect(out[3].content).toEqual([{ type: "text", text: "look", cache_control: MARK }, image]);
  });

  it("gives consecutive turns an identical prefix up to the earlier turn's newest question", () => {
    // What makes the cache hit: the content request N wrote up to its newest
    // question is still a prefix of request N+1. Markers aren't part of the
    // cached content (they move every turn, as in Anthropic's own multi-turn
    // pattern), and a string is the same single text block to the provider, so
    // both are normalised away before comparing.
    const normalise = (messages: WireMessage[]) =>
      JSON.stringify(
        messages.map((m) =>
          Array.isArray(m.content) && m.content.length === 1 && m.content[0].type === "text"
            ? { ...m, content: m.content[0].text }
            : m
        )
      );
    const chat = (n: number): ChatMessage[] => {
      const out: ChatMessage[] = [{ role: "system", content: "SYSTEM PROMPT" }];
      for (let i = 1; i <= n; i++) {
        out.push(
          { role: "user", content: `question ${i}` },
          { role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "t", arguments: "{}" } }] },
          { role: "tool", tool_call_id: `c${i}`, content: "x".repeat(3000) },
          { role: "assistant", content: `answer ${i}` }
        );
      }
      return out;
    };
    const model = "anthropic/claude-sonnet-5.5";
    for (let n = 1; n < 7; n++) {
      const before = withCacheBreakpoints(toWire(chat(n)), model, true);
      const after = withCacheBreakpoints(toWire(chat(n + 1)), model, true);
      const newest = before.length - 4; // request N's newest question
      expect(marked(before)).toContain(newest);
      expect(marked(after)).toContain(newest); // still a breakpoint in request N+1
      expect(normalise(after.slice(0, newest + 1))).toBe(normalise(before.slice(0, newest + 1)));
    }
  });
});
