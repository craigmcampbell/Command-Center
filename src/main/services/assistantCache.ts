// Prompt caching for the Assistant's requests: pure, no I/O, so the rules can be
// tested directly. services/assistant.ts applies it to what `toWire` built.
//
// How OpenRouter caches (https://openrouter.ai/docs/features/prompt-caching and
// https://openrouter.ai/docs/guides/best-practices/prompt-caching, read
// 2026-10-24):
//
// - Automatic, nothing to send: OpenAI (reads 0.25-0.5x the input price, from
//   1024 tokens), DeepSeek (0.1x), Grok, Moonshot, Groq, Z.AI, and Gemini 2.5+
//   "implicit" caching (0.25x, free writes, 1024 tokens on Flash / 4096 on Pro).
// - Needs `cache_control` breakpoints: Anthropic (at most 4 per request; writes
//   cost 1.25x for the default 5-minute TTL or 2x for `"ttl": "1h"`, reads 0.1x;
//   512-4096 tokens minimum depending on the model), Alibaba Qwen on listed
//   models, and Gemini's explicit caching (only the last breakpoint counts, and
//   it bills storage).
// - Form: a content part, `{ type: "text", text, cache_control: { type:
//   "ephemeral" } }`. A prefix shorter than the minimum is simply not cached;
//   the request still succeeds.
// - Usage: `usage.prompt_tokens_details.cached_tokens` (read from cache) and
//   `.cache_write_tokens` (written), both already inside `prompt_tokens`.
//
// So breakpoints go only to Anthropic models. Gemini is left to implicit
// caching, which costs nothing to write, rather than explicit caching, which
// bills storage. Qwen is left alone because its slugs are served by many
// providers, most of which don't take the marker. Every other model gets the
// request exactly as before, byte for byte.
//
// Where the breakpoints go (3 of the 4 allowed):
// 1. The system message: it carries the tool list and system prompt in front
//    of it in the cache hierarchy, and is frozen per chat.
// 2. The newest user message: the request writes everything up to here, so the
//    next model step in this turn, and the next turn, read it back.
// 3. The user message before that: a guaranteed hit point for this request.
//    Anthropic only looks back about 20 blocks from a breakpoint for an earlier
//    write, and a tool-heavy previous turn can be longer than that.
// Only system and user messages are marked: their content-part form is the
// documented one. A user message that is only images (no text part) is skipped.
//
// None of this works unless the prefix is byte-identical between requests; see
// `toWire` and STABLE_STEP_TURNS in assistantCompaction.ts.

import type { ContentPart, WireMessage } from "./assistantTranscript";

const BREAKPOINT = { type: "ephemeral" } as const;

// True for the slugs whose provider needs explicit breakpoints. OpenRouter's
// "~anthropic/…-latest" aliases count too.
export function needsCacheBreakpoints(model: string): boolean {
  return /^~?anthropic\//i.test(model.trim());
}

function markParts(content: string | ContentPart[]): ContentPart[] | null {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content, cache_control: BREAKPOINT }] : null;
  }
  let last = -1;
  content.forEach((p, i) => {
    if (p.type === "text") last = i;
  });
  if (last < 0) return null;
  return content.map((p, i) => (i === last && p.type === "text" ? { ...p, cache_control: BREAKPOINT } : p));
}

// The request's messages with cache breakpoints added where the model's
// provider needs them. Returns the input array itself (untouched) when it
// doesn't, or when caching is switched off. Never modifies the input.
export function withCacheBreakpoints(messages: WireMessage[], model: string, enabled: boolean): WireMessage[] {
  if (!enabled || !needsCacheBreakpoints(model)) return messages;
  const targets = new Set<number>();
  const system = messages.findIndex((m) => m.role === "system");
  if (system >= 0) targets.add(system);
  let users = 0;
  for (let i = messages.length - 1; i >= 0 && users < 2; i--) {
    if (messages[i].role === "user") {
      targets.add(i);
      users++;
    }
  }
  return messages.map((m, i) => {
    if (!targets.has(i) || (m.role !== "system" && m.role !== "user")) return m;
    const content = markParts(m.content);
    return content ? { ...m, content } : m;
  });
}
