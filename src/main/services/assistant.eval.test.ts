// Replay evals: provider streams that have broken the Assistant before, played
// through the real loop (client, SSE parser, tool dispatch, history, traces)
// with only the network and the storage stubbed. Each fixture under
// __fixtures__/openrouter/ is an OpenRouter response body in its wire format —
// keep-alive comments, per-chunk provider/model, a usage chunk with `cost` —
// and a new quirk should land here as a fixture plus a case, ideally captured
// with `scripts/assistant-eval.cjs --record`.
//
// What every case checks beyond its own quirk: the history a provider would be
// sent next is valid (every tool call answered, by a unique id), and the turn's
// trace says what happened without holding any of the text.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTraceRequest, AssistantTraceTool, AssistantTurnTrace } from "../../shared/types";

const settings = vi.hoisted(() => ({ assistant: {} as Record<string, unknown> }));
const store = vi.hoisted(() => ({
  chats: new Map<string, { title: string; messages: any[] }>(),
  traces: new Map<string, AssistantTurnTrace[]>(),
}));

vi.mock("./assistantChats", () => ({
  saveChat: (id: string, title: string, messages: any[]) => {
    const existing = store.chats.get(id);
    store.chats.set(id, { title: existing?.title ?? title, messages: JSON.parse(JSON.stringify(messages)) });
  },
  loadChat: (id: string) => {
    const chat = store.chats.get(id);
    return chat
      ? { id, title: chat.title, pinned: false, messages: JSON.parse(JSON.stringify(chat.messages)), usage: { promptTokens: 0, completionTokens: 0, costUsd: null } }
      : null;
  },
  renameChatIfUnchanged: (id: string, expected: string, title: string) => {
    const chat = store.chats.get(id);
    if (!chat || chat.title !== expected) return false;
    chat.title = title;
    return true;
  },
  addChatUsage: () => true,
  deleteChat: (id: string) => store.chats.delete(id),
  chatImageIds: () => [],
  isAttachmentReferenced: () => false,
}));
// Like the real table: numbered per chat, replaced when re-saved.
vi.mock("./assistantTraces", () => ({
  saveTrace: (chatId: string, trace: AssistantTurnTrace) => {
    const list = store.traces.get(chatId) ?? [];
    const seq = trace.turnSeq > 0 ? trace.turnSeq : list.length + 1;
    const copy = JSON.parse(JSON.stringify({ ...trace, turnSeq: seq }));
    const at = list.findIndex((t) => t.turnSeq === seq);
    if (at >= 0) list[at] = copy;
    else list.push(copy);
    store.traces.set(chatId, list);
    return seq;
  },
  listTraces: (chatId: string) => store.traces.get(chatId) ?? [],
  deleteTraces: (chatId: string) => store.traces.delete(chatId),
}));
vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() } }));
vi.mock("./settings", () => ({
  getAssistantSettings: () => settings.assistant,
  getFirecrawlSettings: () => ({}),
  getOpenAISettings: () => ({}),
  getTodoistSettings: () => ({ apiToken: "t" }),
  getGoogleCalendarSettings: () => ({}),
  getGithubScalarSettings: () => ({}),
  getYnabSettings: () => ({}),
  getReaderSettings: () => ({}),
  listGithubRepoSettings: () => [],
  listVaultSettings: () => [{ label: "Grimoire", path: "/vault" }],
}));
vi.mock("./googleCalendar", () => ({
  getEventsForDay: vi.fn(async (_s: unknown, date: string) => ({ ok: true, events: [], date })),
}));
vi.mock("./docker", () => ({
  getDockerContainers: vi.fn(async () => ({
    ok: true,
    containers: [
      { name: "postgres", image: "postgres:17", state: "running", status: "Up 3 days", ports: [] },
      { name: "redis", image: "redis:8", state: "running", status: "Up 3 days", ports: [] },
    ],
  })),
}));
vi.mock("./notes", () => ({
  searchNotes: vi.fn(async () => ({ ok: true, hits: [], truncated: false })),
  readNoteFile: vi.fn(),
}));
vi.mock("./todoist", () => ({ completeTask: vi.fn(), setTaskDueDate: vi.fn(), createTask: vi.fn(), getDueTasks: vi.fn() }));
vi.mock("./assistantCommands", () => ({ resolveCommand: async () => null, getCommandRow: () => null }));
vi.mock("./assistantSkills", () => ({ readSkillFile: vi.fn() }));
vi.mock("./github", () => ({ getGitHubStatus: vi.fn(), getOpenPullRequests: vi.fn() }));
vi.mock("./git", () => ({ getGitStatuses: vi.fn() }));
vi.mock("./ynab", () => ({
  getUnapprovedTransactions: vi.fn(),
  getCategories: vi.fn(),
  approveTransaction: vi.fn(),
  setTransactionCategory: vi.fn(),
}));
vi.mock("./reader", () => ({ saveLink: vi.fn() }));
vi.mock("./readerFeed", () => ({ listReaderFeed: vi.fn(), moveFeedItemToInbox: vi.fn(), findCachedFeedItem: vi.fn() }));

import { getEventsForDay } from "./googleCalendar";
import { searchNotes } from "./notes";
import { askAssistant, onAssistantChatTitled, openAssistantChat } from "./assistant";
import { hooks, scriptFetch, type Reply, type Sent } from "./assistantTestUtils";

const FIXTURES = path.join(__dirname, "__fixtures__", "openrouter");
const fixture = (name: string, chunkBytes?: number): Reply => {
  const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
  return name.endsWith(".json") ? { json: JSON.parse(text) } : { sse: text, ...(chunkBytes ? { chunkBytes } : {}) };
};

const requests = (trace: AssistantTurnTrace | undefined, purpose = "reply") =>
  (trace?.steps ?? []).filter((s): s is AssistantTraceRequest => s.kind === "request" && s.purpose === purpose);
const tools = (trace: AssistantTurnTrace | undefined) =>
  (trace?.steps ?? []).filter((s): s is AssistantTraceTool => s.kind === "tool");

// The invariant every quirk below threatens: in what goes over the wire, each
// assistant tool call is answered by exactly one tool message with its id, and
// no id is used twice in the conversation.
function expectValidHistory(body: Sent["body"]): void {
  const seen = new Set<string>();
  const messages = body.messages;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;
    const ids = m.tool_calls.map((c: any) => c.id);
    for (const id of ids) {
      expect(id, "every call has an id").toBeTruthy();
      expect(seen.has(id), `call id ${id} is unique`).toBe(false);
      seen.add(id);
    }
    const answers = messages.slice(i + 1, i + 1 + ids.length);
    expect(answers.map((a: any) => a.role)).toEqual(ids.map(() => "tool"));
    expect(answers.map((a: any) => a.tool_call_id)).toEqual(ids);
  }
}

// Traces are sizes and metadata: no fixture's text may turn up in one.
function expectNoText(trace: AssistantTurnTrace | undefined, ...texts: string[]): void {
  const json = JSON.stringify(trace);
  for (const text of texts) expect(json).not.toContain(text);
}

describe("replayed provider streams", () => {
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-assistant-eval-"));
    settings.assistant = {
      apiKey: "sk-or-test",
      model: "test/model",
      memoryPath: path.join(dir, "memory.md"),
      autoTitle: false,
      askBeforeRemember: false,
    };
    store.chats.clear();
    store.traces.clear();
    vi.mocked(getEventsForDay).mockClear();
    vi.mocked(searchNotes).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a provider that sends no tool-call ids: every step's call_0 gets an id of its own", async () => {
    const sent = scriptFetch(fixture("no-ids-step1.sse"), fixture("no-ids-step2.sse"), fixture("final-answer.sse"));
    const reply = await askAssistant(null, "anything on today, and is docker ok?");

    expect(reply).toMatchObject({ ok: true, text: "Nothing on today, and both containers are running." });
    expect(reply.toolCalls.map((c) => [c.name, c.ok])).toEqual([
      ["get_schedule", true],
      ["docker_status", true],
    ]);
    expect(sent).toHaveLength(3);
    expectValidHistory(sent[2].body);
    // The client numbers id-less calls per step, so both steps said call_0.
    const ids = sent[2].body.messages.flatMap((m: any) => m.tool_calls?.map((c: any) => c.id) ?? []);
    expect(new Set(ids).size).toBe(2);

    const trace = reply.trace!;
    expect(trace).toMatchObject({ outcome: "ok", userIndex: 0, model: "test/model" });
    expect(requests(trace).map((r) => [r.step, r.finishReason, r.toolCalls])).toEqual([
      [0, "tool_calls", 1],
      [1, "tool_calls", 1],
      [2, "stop", 0],
    ]);
    expect(tools(trace).map((t) => [t.step, t.name, t.approval, t.ok])).toEqual([
      [0, "get_schedule", "none", true],
      [1, "docker_status", "none", true],
    ]);
    // Usage and cost from each step's usage chunk, summed for the turn.
    expect(requests(trace)[0].usage).toEqual({ promptTokens: 1830, completionTokens: 22, costUsd: 0.000412 });
    expect(trace.usage.promptTokens).toBe(1830 + 1910 + 2004);
    expect(trace.usage.costUsd).toBeCloseTo(0.000412 + 0.000398 + 0.000421, 9);
    expect(store.traces.get(reply.conversationId)).toHaveLength(1);
    expectNoText(trace, "Nothing on today", "postgres", "2026-10-24", "docker ok");
  });

  it("duplicate ids within one step: both calls run and each result pairs with its own call", async () => {
    const sent = scriptFetch(fixture("duplicate-ids.sse"), fixture("final-answer.sse"));
    const reply = await askAssistant(null, "today and tomorrow?");

    expect(reply.ok).toBe(true);
    expect(vi.mocked(getEventsForDay).mock.calls.map((c) => c[1])).toEqual(["2026-10-24", "2026-10-25"]);
    expectValidHistory(sent[1].body);
    const [call, ...results] = sent[1].body.messages.slice(2, 5);
    expect(call.tool_calls[0].id).toBe("call_0");
    expect(call.tool_calls[1].id).not.toBe("call_0");
    // Each result is the one for its own date, not two copies of the first.
    expect(results.map((r: any) => JSON.parse(r.content).date)).toEqual(["2026-10-24", "2026-10-25"]);
    expect(tools(reply.trace)).toHaveLength(2);
  });

  it("a 200 with an error body fails the turn, rolls it back, and records why", async () => {
    scriptFetch(fixture("error-200.json"));
    const reply = await askAssistant(null, "hi");

    expect(reply).toMatchObject({ ok: false, reason: "Model error: Provider returned error" });
    expect(store.chats.size).toBe(0);
    const trace = reply.trace!;
    expect(trace).toMatchObject({ outcome: "error", error: "Model error: Provider returned error" });
    expect(requests(trace)).toMatchObject([{ step: 0, error: "Model error: Provider returned error", toolCalls: 0 }]);
    // Recorded even though the chat itself was never saved.
    expect(store.traces.get(reply.conversationId)).toHaveLength(1);
  });

  it("an error chunk after the first tokens fails the turn instead of keeping the half answer", async () => {
    scriptFetch(fixture("error-midstream.sse"));
    const deltas: string[] = [];
    const reply = await askAssistant(null, "hi", hooks({ onText: (d) => deltas.push(d) }));

    expect(deltas).toEqual(["Let me"]);
    expect(reply).toMatchObject({ ok: false, reason: "Model error: Provider returned error" });
    expect(requests(reply.trace)[0]).toMatchObject({ outputChars: 6, error: "Model error: Provider returned error" });
    expect(requests(reply.trace)[0].firstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it("a stream that ends with neither finish_reason nor [DONE] is a failure, not a short answer", async () => {
    scriptFetch(fixture("no-finish-reason.sse"));
    const reply = await askAssistant(null, "which PRs are open?");

    expect(reply).toMatchObject({ ok: false, reason: "The response stream ended unexpectedly" });
    expect(store.chats.size).toBe(0);
    expect(requests(reply.trace)[0]).toMatchObject({ error: "The response stream ended unexpectedly" });
    expect(requests(reply.trace)[0].finishReason).toBeUndefined();
  });

  it("[DONE] without a finish_reason is still a clean end", async () => {
    scriptFetch(fixture("done-without-finish.sse"));
    const reply = await askAssistant(null, "done?");
    expect(reply).toMatchObject({ ok: true, text: "All done." });
    expect(reply.trace).toMatchObject({ outcome: "ok" });
  });

  it("parallel tool calls interleaved across fragments, split mid-character on the byte stream", async () => {
    const sent = scriptFetch(fixture("split-tool-calls.sse", 7), fixture("final-answer.sse", 5));
    const reply = await askAssistant(null, "find the café menu note, and am I free monday?");

    expect(reply.ok).toBe(true);
    expect(searchNotes).toHaveBeenCalledWith("Grimoire", "café menu");
    expect(getEventsForDay).toHaveBeenCalledWith({}, "2026-10-27");
    const call = sent[1].body.messages[2];
    expect(call.tool_calls.map((c: any) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ["call_Qx1", "search_notes", '{"query":"café menu"}'],
      ["call_Qx2", "get_schedule", '{"date":"2026-10-27"}'],
    ]);
    expectValidHistory(sent[1].body);
    expect(requests(reply.trace)[0]).toMatchObject({ toolCalls: 2, outputChars: 0, finishReason: "tool_calls" });
    expect(requests(reply.trace)[0].firstTokenMs).toBeUndefined();
    expect(tools(reply.trace).map((t) => t.name)).toEqual(["search_notes", "get_schedule"]);
    expectNoText(reply.trace, "café");
  });

  it("a reasoning Title model that runs out of tokens keeps the placeholder, and the trace says why", async () => {
    settings.assistant.autoTitle = true;
    onAssistantChatTitled(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The reply's request goes first; the title request is sent right behind it.
    const sent = scriptFetch(fixture("done-without-finish.sse"), fixture("reasoning-title-length.sse"));
    const reply = await askAssistant(null, "help me plan the ship date");

    expect(reply.ok).toBe(true);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(String(warn.mock.calls[0][0])).toMatch(/ran out of tokens/);
    expect(sent[1].body.messages[0].content).toMatch(/^You name chats/);
    expect(store.chats.get(reply.conversationId)!.title).toBe("help me plan the ship date");

    // The title usually finishes after the reply, so it reaches the stored
    // trace by a re-write rather than the reply's copy.
    await vi.waitFor(() => expect(requests(store.traces.get(reply.conversationId)![0], "title")).toHaveLength(1));
    const stored = store.traces.get(reply.conversationId)!;
    expect(stored).toHaveLength(1);
    expect(requests(stored[0], "title")[0]).toMatchObject({
      step: -1,
      finishReason: "length",
      outputChars: 0,
      usage: { promptTokens: 48, completionTokens: 256 },
    });
    // The title is billed to the chat separately, not to the turn.
    expect(stored[0].usage.promptTokens).toBe(900);
    warn.mockRestore();
  });

  it("a reopened chat shows each reply with the trace of the turn that produced it", async () => {
    scriptFetch(fixture("final-answer.sse"));
    const first = await askAssistant(null, "one");
    scriptFetch(fixture("error-200.json"));
    const failed = await askAssistant(first.conversationId, "two");
    expect(failed.ok).toBe(false);
    scriptFetch(fixture("done-without-finish.sse"));
    await askAssistant(first.conversationId, "two again");

    const chat = openAssistantChat(first.conversationId);
    const replies = chat.items.filter((i) => i.role === "assistant");
    expect(replies.map((r) => [r.text, r.trace?.turnSeq, r.trace?.userIndex])).toEqual([
      ["Nothing on today, and both containers are running.", 1, 0],
      // Turn 2 failed and was rolled back; the answer that stands is turn 3's.
      ["All done.", 3, 1],
    ]);
  });
});
