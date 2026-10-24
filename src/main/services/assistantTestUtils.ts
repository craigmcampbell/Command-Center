// Test-only helpers for driving the Assistant's loop against a scripted
// OpenRouter: shared by assistant.test.ts (behaviour) and
// assistant.eval.test.ts (replayed provider streams). No vi.mock here — mocks
// are hoisted per test file, so each suite declares its own.

import { vi } from "vitest";
import type { AskHooks } from "./assistant";

export const hooks = (over: Partial<AskHooks> = {}): AskHooks => ({
  onText: () => {},
  onApproval: () => {},
  ...over,
});

export interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { model: string; messages: any[]; tools: any[] };
}

export type Reply =
  | { status?: number; json: unknown }
  // A server-sent-events body, delivered in pieces; `hang` opens a stream that
  // never produces anything, for the idle-timeout test.
  | { sse: string; hang?: boolean; chunkBytes?: number }
  | { hang: true };

// Stubs global fetch with a scripted sequence of replies. The service keeps
// mutating its history array after the request, but the body is serialised at
// call time, so parsing it back gives exactly what went over the wire.
export function scriptFetch(...replies: Reply[]): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      });
      const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
      if ("sse" in reply || "hang" in reply) {
        const encoder = new TextEncoder();
        // Split by character by default; `chunkBytes` splits the encoded bytes
        // instead, so a multi-byte character can straddle two reads as it does
        // on a real socket.
        const pieces: Uint8Array[] = [];
        if ("sse" in reply && reply.chunkBytes) {
          const bytes = encoder.encode(reply.sse);
          for (let i = 0; i < bytes.length; i += reply.chunkBytes) pieces.push(bytes.slice(i, i + reply.chunkBytes));
        } else if ("sse" in reply) {
          for (const text of reply.sse.match(/[\s\S]{1,11}/g) ?? []) pieces.push(encoder.encode(text));
        }
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            for (const piece of pieces) c.enqueue(piece);
            if ("sse" in reply && !reply.hang) c.close();
          },
        });
        // Like real fetch, aborting the request errors the body read.
        init.signal?.addEventListener("abort", () =>
          controller.error(new DOMException("aborted", "AbortError"))
        );
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200 });
    })
  );
  return sent;
}

export const stop = (content: string): Reply => ({
  json: { choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] },
});
export const callTools = (...calls: { id: string; name: string; args?: object }[]): Reply => ({
  json: {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
          })),
        },
      },
    ],
  },
});

export const sse = (...events: (object | string)[]): Reply => ({
  sse: events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join(""),
});
export const delta = (d: object, finish: string | null = null) => ({
  choices: [{ delta: d, finish_reason: finish }],
});
