// OpenRouter chat-completions client for the Assistant: one streamed request,
// parsed from server-sent events. No knowledge of tools, memory or history —
// that is services/assistant.ts. Kept separate so the wire format (and its
// several failure shapes) can be reasoned about, and tested, on its own.
//
// OpenRouter fronts many providers behind one key, so the model is whatever
// slug the user sets in Settings. Not every model supports tool calling —
// OpenRouter's 400 for that passes through verbatim.

import type { AssistantUsage } from "../../shared/types";
import type { ChatMessage, ToolCall, WireMessage } from "./assistantTranscript";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
// Not fetchWithTimeout: its 20s deadline suits dashboard reads, and a fixed
// total deadline would cut off a long streamed answer. This is an IDLE timeout —
// re-armed on every chunk, including OpenRouter's keep-alive comments — so a
// reasoning model that thinks silently for a while is fine but a dead
// connection still gets cut.
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 4096;

// Transient failures (429, 5xx, a dropped connection) are retried, but only
// while nothing has reached the user: once text has streamed, a second attempt
// would answer again underneath it. Tools never come into it: they run after a
// request returns, so a retried request has run none. Mutable for tests.
export const RETRY_POLICY = {
  maxRetries: 2,
  baseDelayMs: 1000,
  // A Retry-After longer than this is reported, not waited out: the user is
  // looking at a spinner.
  maxWaitMs: 20_000,
};

export interface CompletionResult {
  ok: boolean;
  reason?: string;
  needsSetup?: boolean;
  // The caller's signal fired (the user pressed Stop). `partialText` is
  // whatever had streamed; tool-call fragments are discarded, since half a
  // call is never valid.
  aborted?: boolean;
  partialText?: string;
  message?: Extract<ChatMessage, { role: "assistant" }>;
  finishReason?: string;
  usage?: AssistantUsage;
  // The model that actually answered, as OpenRouter reports it. With fallbacks
  // this can differ from the one asked for.
  model?: string;
  // Internal to this module: a failure worth another attempt, and how long the
  // server asked us to wait first.
  retryable?: boolean;
  retryAfterMs?: number;
}

export interface CompleteParams {
  apiKey: string;
  model: string;
  messages: WireMessage[];
  // Tried in order by OpenRouter itself (its `models` parameter) when `model`
  // fails: rate-limited, down, or rejecting the request.
  fallbackModels?: string[];
  // Omitted (not sent as an empty array — OpenAI-style APIs reject `tools: []`)
  // for requests that shouldn't call anything, like title generation.
  tools?: unknown[];
  onText: (delta: string) => void;
  maxTokens?: number;
  // The user's Stop. Distinct from the idle timer, which this module owns.
  signal?: AbortSignal;
}

function toResult(
  content: string | null,
  toolCalls: ToolCall[],
  finishReason: string | undefined,
  usage: AssistantUsage | undefined,
  model: string | undefined
): CompletionResult {
  return {
    ok: true,
    finishReason,
    usage,
    ...(model ? { model } : {}),
    message: {
      role: "assistant",
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(model ? { model } : {}),
    },
  };
}

// OpenRouter reports tokens in the OpenAI shape plus a non-standard `cost`
// (credits, which are USD). Absent cost stays null rather than becoming 0, so
// a provider that doesn't report one never looks free.
function parseUsage(raw: any): AssistantUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const promptTokens = Number(raw.prompt_tokens);
  const completionTokens = Number(raw.completion_tokens);
  if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return undefined;
  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    costUsd: typeof raw.cost === "number" && Number.isFinite(raw.cost) ? raw.cost : null,
  };
}

// Parses the SSE stream (OpenAI chunk format). Text deltas are pushed to
// `onText` as they arrive; tool calls arrive as fragments keyed by `index` and
// are only usable once the stream ends, so they're assembled and returned.
async function readStream(
  body: ReadableStream<Uint8Array>,
  arm: () => void,
  onText: (delta: string) => void,
  userSignal: AbortSignal | undefined,
  idleSignal: AbortSignal
): Promise<CompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, ToolCall>();
  let buffer = "";
  let content = "";
  let finishReason: string | undefined;
  let usage: AssistantUsage | undefined;
  let model: string | undefined;
  let sawDone = false;
  let streamError: string | undefined;

  const handleLine = (line: string): void => {
    // Only `data:` lines carry payload. Lines starting with ":" are SSE
    // comments — OpenRouter sends ": OPENROUTER PROCESSING" as a keep-alive.
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      sawDone = true;
      return;
    }
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    // A failure after the first token can't change the HTTP status, so it
    // arrives in-band as an `error` chunk.
    if (chunk.error) {
      streamError = chunk.error.message ?? "the provider failed";
      return;
    }
    // Usually rides on a final chunk with no choices, so read it first.
    usage = parseUsage(chunk.usage) ?? usage;
    if (typeof chunk.model === "string" && chunk.model) model = chunk.model;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    for (const fragment of delta.tool_calls ?? []) {
      const index = typeof fragment.index === "number" ? fragment.index : 0;
      const call = calls.get(index) ?? {
        id: "",
        type: "function" as const,
        function: { name: "", arguments: "" },
      };
      if (fragment.id) call.id = fragment.id;
      // The name arrives whole in the first fragment; only arguments are split.
      if (fragment.function?.name && !call.function.name) call.function.name = fragment.function.name;
      if (typeof fragment.function?.arguments === "string") {
        call.function.arguments += fragment.function.arguments;
      }
      calls.set(index, call);
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) handleLine(buffer.replace(/\r$/, ""));
  } catch {
    if (userSignal?.aborted) return { ok: false, aborted: true, partialText: content };
    if (idleSignal.aborted) return { ok: false, reason: "OpenRouter stopped responding", usage };
    // A dropped connection. Worth another go only if nothing was shown yet;
    // complete() checks that, since only it sees every attempt's text.
    return { ok: false, reason: "The response stream was interrupted", retryable: true, usage };
  }

  // Failures still carry any usage that arrived: it was billed, and the daily
  // spending cap has to see it.
  if (streamError) return { ok: false, reason: `Model error: ${streamError}`, usage };
  if (finishReason === "error") return { ok: false, reason: "Model error: the provider failed", usage };
  // A clean end has a finish_reason or [DONE]; neither means the connection
  // dropped mid-answer, and a half-answer must not be mistaken for a whole one.
  if (!finishReason && !sawDone) {
    return { ok: false, reason: "The response stream ended unexpectedly", retryable: true, usage };
  }

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
    .filter((call) => call.function.name);
  return toResult(content, toolCalls, finishReason, usage, model);
}

// Retry-After is either seconds or an HTTP date.
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function complete(params: CompleteParams): Promise<CompletionResult> {
  let streamed = false;
  const onText = (delta: string): void => {
    streamed = true;
    params.onText(delta);
  };
  // Usage from attempts that failed after reporting it: billed all the same.
  let earlier: AssistantUsage | undefined;
  const finish = (result: CompletionResult): CompletionResult => {
    const { retryable: _r, retryAfterMs: _w, ...rest } = result;
    const usage = sumUsage(earlier, rest.usage);
    return usage ? { ...rest, usage } : rest;
  };
  for (let retry = 0; ; retry++) {
    const result = await attempt({ ...params, onText });
    if (result.ok || result.aborted || !result.retryable || streamed) return finish(result);
    if (retry >= RETRY_POLICY.maxRetries) return finish(result);
    const wait = result.retryAfterMs ?? RETRY_POLICY.baseDelayMs * 3 ** retry;
    if (wait > RETRY_POLICY.maxWaitMs) return finish(result);
    earlier = sumUsage(earlier, result.usage);
    await sleep(wait, params.signal);
    if (params.signal?.aborted) return finish({ ok: false, aborted: true, partialText: "" });
  }
}

function sumUsage(a: AssistantUsage | undefined, b: AssistantUsage | undefined): AssistantUsage | undefined {
  if (!a || !b) return a ?? b;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    // Null only if neither reported a cost; a partial figure is still spend.
    costUsd: a.costUsd === null && b.costUsd === null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0),
  };
}

async function attempt(params: CompleteParams): Promise<CompletionResult> {
  const { apiKey, model, messages, tools, onText, signal: userSignal } = params;
  const fallbacks = (params.fallbackModels ?? []).filter((m) => m && m !== model);
  const maxTokens = params.maxTokens ?? MAX_OUTPUT_TOKENS;
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), STREAM_IDLE_TIMEOUT_MS);
  };
  arm();
  const signal = userSignal ? AbortSignal.any([idle.signal, userSignal]) : idle.signal;

  try {
    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Optional attribution header; it only labels the app in OpenRouter's UI.
          "X-Title": "Command Center",
        },
        body: JSON.stringify({
          model,
          ...(fallbacks.length ? { models: [model, ...fallbacks] } : {}),
          messages,
          ...(tools?.length ? { tools } : {}),
          max_tokens: maxTokens,
          stream: true,
          // Ask OpenRouter to report token counts and cost with the response.
          usage: { include: true },
        }),
        signal,
      });
    } catch {
      if (userSignal?.aborted) return { ok: false, aborted: true, partialText: "" };
      // A connection that never opened is retried; one that opened and then
      // sat silent for the whole idle window is not worth another 90 seconds.
      return idle.signal.aborted
        ? { ok: false, reason: "OpenRouter took too long to respond" }
        : { ok: false, reason: "Couldn't reach OpenRouter", retryable: true };
    }

    const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream");
    if (response.ok && isStream && response.body) {
      return await readStream(response.body, arm, onText, userSignal, idle.signal);
    }

    // Everything else is a plain JSON body: an HTTP error, a 200 carrying an
    // `error` object (OpenRouter reports some upstream failures that way), or
    // a provider that ignored `stream` and answered in one piece.
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON error pages (gateway failures) fall through to the status check.
      if (userSignal?.aborted) return { ok: false, aborted: true, partialText: "" };
    }
    const upstream: string | undefined = body?.error?.message;

    if (response.status === 401) {
      return {
        ok: false,
        needsSetup: true,
        reason: "OpenRouter rejected the API key — it must be a regular key, not a Management key",
      };
    }
    if (response.status === 402) return { ok: false, reason: "OpenRouter credits exhausted" };
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    if (response.status === 429) {
      return { ok: false, reason: "Rate limited — try again shortly", retryable: true, retryAfterMs };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: upstream ? `Request rejected: ${upstream}` : `OpenRouter error (${response.status})`,
        ...(response.status >= 500 ? { retryable: true, retryAfterMs } : {}),
      };
    }
    if (upstream) return { ok: false, reason: `Model error: ${upstream}` };

    const choice = body?.choices?.[0];
    const message = choice?.message;
    if (!message || message.role !== "assistant") {
      return { ok: false, reason: "OpenRouter returned an unexpected response" };
    }
    const text = typeof message.content === "string" ? message.content : null;
    if (text) onText(text);
    return toResult(
      text,
      Array.isArray(message.tool_calls) ? message.tool_calls : [],
      choice.finish_reason,
      parseUsage(body.usage),
      typeof body.model === "string" && body.model ? body.model : undefined
    );
  } finally {
    clearTimeout(timer);
  }
}
