import { describe, expect, it } from "vitest";
import {
  cleanFact,
  cleanTitle,
  DECLINED_MESSAGE,
  deriveTitle,
  describeToolCall,
  summarizeArguments,
  toTranscript,
  usedCallIds,
  withUniqueCallIds,
  type ChatMessage,
} from "./assistantTranscript";

const call = (id: string, name: string, args: object = {}) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

describe("deriveTitle", () => {
  it("flattens whitespace and keeps short titles whole", () => {
    expect(deriveTitle("  what's\n due   today? ")).toBe("what's due today?");
  });
  it("truncates long titles with an ellipsis", () => {
    const title = deriveTitle("a".repeat(200));
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });
  it("never returns an empty title", () => {
    expect(deriveTitle("   ")).toBe("New chat");
  });
});

describe("cleanFact", () => {
  it("collapses whitespace and caps length", () => {
    expect(cleanFact("  likes \n terse   answers ")).toBe("likes terse answers");
    expect(cleanFact("x".repeat(900))).toHaveLength(500);
  });
});

describe("toTranscript", () => {
  it("drops system and tool plumbing and keeps the conversation", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello." },
    ];
    expect(toTranscript(messages)).toEqual([
      { role: "user", text: "hi", turn: 0, toolCalls: [], remembered: [] },
      { role: "assistant", text: "Hello.", toolCalls: [], remembered: [] },
    ]);
  });

  it("folds every model step of a turn into one reply, with chips", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "what's due?" },
      {
        role: "assistant",
        content: "Let me check.",
        tool_calls: [call("c1", "get_due_tasks"), call("c2", "docker_status")],
      },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ total: 0, tasks: [] }) },
      { role: "tool", tool_call_id: "c2", content: JSON.stringify({ error: "Docker isn't running" }) },
      { role: "assistant", content: "One task. Docker is down." },
      { role: "user", content: "thanks" },
      { role: "assistant", content: "Anytime." },
    ];
    const items = toTranscript(messages);
    expect(items.map((i) => i.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(items[1].text).toBe("Let me check.\n\nOne task. Docker is down.");
    expect(items[1].toolCalls).toEqual([
      { name: "get_due_tasks", ok: true, result: '{"total":0,"tasks":[]}' },
      { name: "docker_status", ok: false, result: "Docker isn't running" },
    ]);
    expect(items[3].toolCalls).toEqual([]);
  });

  it("restores remembered facts, but only the ones that were actually saved", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "remember things" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          call("c1", "remember", { fact: "  Prefers   terse answers " }),
          call("c2", "remember", { fact: "too much" }),
        ],
      },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ saved: true }) },
      { role: "tool", tool_call_id: "c2", content: JSON.stringify({ error: "Memory is full" }) },
      { role: "assistant", content: "Saved one." },
    ];
    const reply = toTranscript(messages)[1];
    expect(reply.remembered).toEqual(["Prefers terse answers"]);
    expect(reply.toolCalls).toMatchObject([
      { name: "remember", ok: true },
      { name: "remember", ok: false, result: "Memory is full" },
    ]);
  });

  it("treats a tool call with no recorded result as failed", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "x" },
      { role: "assistant", content: null, tool_calls: [call("c1", "get_schedule")] },
    ];
    expect(toTranscript(messages)[1].toolCalls).toEqual([
      { name: "get_schedule", ok: false, result: "No result was recorded" },
    ]);
  });
});

describe("cleanTitle", () => {
  it("passes a plain title through", () => {
    expect(cleanTitle("Sprint planning notes")).toBe("Sprint planning notes");
  });
  it("strips wrapping quotes, markdown and a trailing full stop", () => {
    expect(cleanTitle('"Docker port question."')).toBe("Docker port question");
    expect(cleanTitle("**Gift ideas for Mum**")).toBe("Gift ideas for Mum");
    expect(cleanTitle("# Weekly review")).toBe("Weekly review");
    expect(cleanTitle("“Quarterly taxes”")).toBe("Quarterly taxes");
    expect(cleanTitle("`git rebase help`")).toBe("git rebase help");
  });
  it("drops a leading Title: label", () => {
    expect(cleanTitle("Title: Moving to Denver")).toBe("Moving to Denver");
  });
  it("keeps a question mark", () => {
    expect(cleanTitle("What is due today?")).toBe("What is due today?");
  });
  it("uses only the first non-empty line", () => {
    expect(cleanTitle("\n\nTrip planning\nHere is why I chose it.")).toBe("Trip planning");
  });
  it("discards a reasoning preamble", () => {
    expect(cleanTitle("<think>The user asks about X so a title would be…</think>\nAbout X")).toBe("About X");
  });
  it("collapses whitespace and caps the length", () => {
    expect(cleanTitle("a   b \t c")).toBe("a b c");
    const long = cleanTitle("word ".repeat(40));
    expect(long).toHaveLength(60);
    expect(long!.endsWith("…")).toBe(true);
  });
  it("returns null when nothing usable is left", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle("   \n  ")).toBeNull();
    expect(cleanTitle('""')).toBeNull();
    expect(cleanTitle("<think>only thinking</think>")).toBeNull();
  });
});

describe("summarizeArguments", () => {
  it("reads like key: value pairs", () => {
    expect(summarizeArguments('{"query":"sprint","vault":"Main"}')).toBe("query: sprint, vault: Main");
  });
  it("is empty for a tool with no arguments", () => {
    expect(summarizeArguments("{}")).toBe("");
    expect(summarizeArguments("")).toBe("");
  });
  it("shows non-string values as JSON", () => {
    expect(summarizeArguments('{"limit":5,"flags":["a","b"]}')).toBe('limit: 5, flags: ["a","b"]');
  });
  it("keeps malformed arguments visible rather than hiding what the model sent", () => {
    expect(summarizeArguments("{oops")).toBe("{oops");
  });
  it("is bounded and one line", () => {
    const out = summarizeArguments(JSON.stringify({ text: "x\ny ".repeat(200) }));
    expect(out).toHaveLength(160);
    expect(out).not.toContain("\n");
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("describeToolCall", () => {
  const call = (name: string, args: object = {}) => ({
    id: "c1",
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  });

  it("describes a successful call with its arguments and result", () => {
    expect(describeToolCall(call("get_schedule", { date: "2026-10-14" }), '{"events":[]}')).toEqual({
      name: "get_schedule",
      ok: true,
      args: "date: 2026-10-14",
      result: '{"events":[]}',
    });
  });

  it("carries the error message for a failed call", () => {
    expect(describeToolCall(call("docker_status"), JSON.stringify({ error: "Docker isn't running" }))).toEqual({
      name: "docker_status",
      ok: false,
      result: "Docker isn't running",
    });
  });

  it("recognises a declined confirmation", () => {
    expect(describeToolCall(call("complete_task", { task_id: "t1" }), JSON.stringify({ error: DECLINED_MESSAGE }))).toEqual({
      name: "complete_task",
      ok: false,
      declined: true,
      args: "task_id: t1",
      result: DECLINED_MESSAGE,
    });
  });

  it("truncates a large result for display", () => {
    const described = describeToolCall(call("get_due_tasks"), JSON.stringify({ tasks: "x".repeat(5000) }));
    expect(described.result).toHaveLength(1200);
    expect(described.result!.endsWith("…")).toBe(true);
  });

  it("treats a missing result as a failure", () => {
    expect(describeToolCall(call("get_due_tasks"), undefined)).toMatchObject({
      ok: false,
      result: "No result was recorded",
    });
  });
});

describe("withUniqueCallIds", () => {
  const call = (id: string) => ({ id, type: "function" as const, function: { name: "x", arguments: "{}" } });
  let n = 0;
  const makeId = () => `new_${++n}`;

  it("keeps unique ids and the same objects", () => {
    const calls = [call("a"), call("b")];
    const out = withUniqueCallIds(calls, new Set(), makeId);
    expect(out[0]).toBe(calls[0]);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("replaces empty ids, repeats within a step, and ids taken earlier in the chat", () => {
    n = 0;
    const out = withUniqueCallIds([call(""), call("a"), call("a"), call("old")], new Set(["old"]), makeId);
    expect(out.map((c) => c.id)).toEqual(["new_1", "a", "new_2", "new_3"]);
  });

  it("collects the ids a chat already uses", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [call("a"), call("b")] },
      { role: "tool", tool_call_id: "a", content: "{}" },
    ];
    expect([...usedCallIds(messages)]).toEqual(["a", "b"]);
  });
});
