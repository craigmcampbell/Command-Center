import { useCallback, useEffect, useRef, useState } from "react";
import { previewUrlsToRelease, type PendingAttachment } from "../lib/attachments";
import type {
  AssistantApproval,
  AssistantAttachmentInfo,
  AssistantReply,
  AssistantToolCall,
  AssistantTurnTrace,
  AssistantUsage,
} from "../../../shared/types";
import { sumUsage } from "../../../shared/assistantUsage";

// All the state and actions of one Assistant conversation, shared by the
// dashboard tab and the quick panel so they behave identically.
//
// The renderer holds display text plus an opaque conversation id; the real
// message history (tool calls and all) lives in the main process — see
// services/assistant.ts. A reply is streamed into a placeholder bubble through
// `assistant:delta`, then REPLACED in place by the resolved reply, which is
// authoritative (it carries the tool chips, and on failure it removes the
// partial text because main has rolled that turn back).

// A tool call in flight, or just finished, while its reply is still arriving.
// Replaced wholesale by the finished reply's `toolCalls`, which also carry the
// arguments and result.
export interface LiveTool {
  callId: string;
  name: string;
  args?: string;
  status: "running" | "done" | "failed" | "declined";
  startedAt: number;
}

export interface ChatItem {
  id: number;
  role: "user" | "assistant" | "error" | "summary";
  text: string;
  // On a user message: the slash command it ran.
  command?: string;
  // On a user message: attached files. `previewUrl` is set for ones just sent
  // from this window; a reopened chat loads images through readAttachment.
  attachments?: (AssistantAttachmentInfo & { previewUrl?: string })[];
  // Set while the reply is still arriving; ties streamed deltas and
  // confirmation cards to this bubble. The final reply clears it.
  requestId?: string;
  // Actions the assistant is waiting on the user to allow or deny.
  approvals?: AssistantApproval[];
  // What the assistant is doing right now (only while `requestId` is set).
  liveTools?: LiveTool[];
  // On an error: the fix lives in Settings, so offer a way there.
  needsSetup?: boolean;
  // The user pressed Stop; `text` is what had arrived.
  stopped?: boolean;
  toolCalls?: AssistantToolCall[];
  remembered?: string[];
  // On an assistant reply: the model that answered.
  model?: string;
  // Part of the reply's cost went unreported, so the caps couldn't count it.
  costUnreported?: boolean;
  // Timings and sizes of the turn behind this reply (or this error).
  trace?: AssistantTurnTrace;
}

export interface UseAssistantChatOptions {
  // Called after a reply is saved (the chat exists, or moved up the list).
  onSaved?: () => void;
}

const NO_USAGE: AssistantUsage = { promptTokens: 0, completionTokens: 0, costUsd: null };

export function useAssistantChat({ onSaved }: UseAssistantChatOptions = {}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [usage, setUsage] = useState<AssistantUsage>(NO_USAGE);

  // Mirrors of state for callbacks that must see the latest value without
  // being re-created (and re-subscribed) on every render.
  const nextId = useRef(1);
  const busyRef = useRef(false);
  const itemsRef = useRef<ChatItem[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const activeRequest = useRef<string | null>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // A sent picture is shown from its local object URL until the transcript
  // moves on (a new chat, another chat opened, a compaction reload), then the
  // URL is released; left alone, each one would pin the image's bytes for the
  // life of the window.
  const shownPreviews = useRef<Set<string>>(new Set());
  useEffect(() => {
    const { keep, release } = previewUrlsToRelease(shownPreviews.current, items);
    for (const url of release) URL.revokeObjectURL(url);
    shownPreviews.current = keep;
  }, [items]);
  useEffect(
    () => () => {
      for (const url of shownPreviews.current) URL.revokeObjectURL(url);
    },
    []
  );
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const setConversation = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setConversationId(id);
  }, []);

  const begin = useCallback((requestId: string) => {
    busyRef.current = true;
    activeRequest.current = requestId;
    setBusy(true);
  }, []);

  const end = useCallback(() => {
    busyRef.current = false;
    activeRequest.current = null;
    setBusy(false);
  }, []);

  // Streamed text and confirmation cards go to whichever bubble owns the
  // request id. One for a request that already finished matches nothing.
  useEffect(() => {
    const offDelta = window.api.assistant.onDelta(({ requestId, text }) => {
      setItems((prev) =>
        prev.map((item) =>
          item.requestId === requestId ? { ...item, text: item.text + text } : item
        )
      );
    });
    const offApproval = window.api.assistant.onApproval((approval) => {
      setItems((prev) =>
        prev.map((item) =>
          item.requestId === approval.requestId
            ? { ...item, approvals: [...(item.approvals ?? []), approval] }
            : item
        )
      );
    });
    const offTool = window.api.assistant.onTool((event) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.requestId !== event.requestId) return item;
          const tools = item.liveTools ?? [];
          if (event.phase === "start") {
            if (tools.some((t) => t.callId === event.callId)) return item;
            return {
              ...item,
              liveTools: [
                ...tools,
                { callId: event.callId, name: event.name, args: event.args, status: "running", startedAt: Date.now() },
              ],
            };
          }
          const status = event.ok ? "done" : event.declined ? "declined" : "failed";
          return {
            ...item,
            liveTools: tools.map((t) => (t.callId === event.callId ? { ...t, status } : t)),
          };
        })
      );
    });
    return () => {
      offDelta();
      offApproval();
      offTool();
    };
  }, []);

  // Loads a saved chat into view. Returns false if it no longer exists.
  const openChat = useCallback(
    async (id: string): Promise<boolean> => {
      if (busyRef.current) return false;
      const chat = await window.api.assistant.chats.open(id);
      if (!chat.ok) return false;
      setConversation(id);
      setTitle(chat.title);
      setUsage(chat.usage);
      setItems(
        chat.items.map((item) => ({
          id: nextId.current++,
          role: item.role,
          text: item.text,
          ...(item.command ? { command: item.command } : {}),
          ...(item.model ? { model: item.model } : {}),
          ...(item.attachments ? { attachments: item.attachments } : {}),
          toolCalls: item.toolCalls,
          remembered: item.remembered,
          ...(item.trace ? { trace: item.trace } : {}),
        }))
      );
      return true;
    },
    [setConversation]
  );

  const finalItem = (id: number, reply: AssistantReply): ChatItem =>
    reply.ok
      ? {
          id,
          role: "assistant",
          text: reply.text || "(no reply)",
          toolCalls: reply.toolCalls,
          remembered: reply.remembered,
          stopped: reply.stopped,
          ...(reply.model ? { model: reply.model } : {}),
          ...(reply.costUnreported ? { costUnreported: true } : {}),
          ...(reply.attachments?.length ? { attachments: reply.attachments } : {}),
          ...(reply.trace ? { trace: reply.trace } : {}),
        }
      : {
          id,
          role: "error",
          text: reply.reason ?? "Something went wrong",
          needsSetup: reply.needsSetup,
          ...(reply.trace ? { trace: reply.trace } : {}),
        };

  const afterReply = useCallback(
    (reply: AssistantReply) => {
      if (reply.conversationId) setConversation(reply.conversationId);
      if (reply.ok) {
        setUsage((u) => sumUsage(u, reply.usage));
        onSavedRef.current?.();
      }
      end();
      // Older messages were summarized first, so the divider (and the summary
      // request's cost) only appear in a freshly loaded transcript.
      if (reply.ok && reply.compacted && reply.conversationId) void openChat(reply.conversationId);
    },
    [end, openChat, setConversation]
  );

  const send = useCallback(
    async (raw: string, command?: string, files: PendingAttachment[] = []): Promise<void> => {
      const text = raw.trim();
      // A command can run with nothing typed after it, and a file with no words.
      if ((!text && !command && files.length === 0) || busyRef.current) return;
      const requestId = crypto.randomUUID();
      const replyId = nextId.current++;
      begin(requestId);
      setItems((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "user",
          text,
          ...(command ? { command } : {}),
          ...(files.length
            ? {
                attachments: files.map((f) => ({
                  id: f.key,
                  name: f.name,
                  mime: f.mime,
                  kind: f.kind,
                  size: f.size,
                  previewUrl: f.previewUrl,
                })),
              }
            : {}),
        },
        { id: replyId, role: "assistant", text: "", requestId },
      ]);
      const reply = await window.api.assistant.ask(
        conversationIdRef.current,
        text,
        requestId,
        command,
        files.length ? files.map((f) => ({ name: f.name, mime: f.mime, data: f.data })) : undefined
      );
      setItems((prev) => prev.map((item) => (item.id === replyId ? finalItem(replyId, reply) : item)));
      afterReply(reply);
    },
    [afterReply, begin]
  );

  const regenerate = useCallback(async (): Promise<void> => {
    const chatId = conversationIdRef.current;
    if (!chatId || busyRef.current) return;
    const previous = [...itemsRef.current]
      .reverse()
      .find((item) => item.role === "assistant" && !item.requestId);
    if (!previous) return;
    const requestId = crypto.randomUUID();
    begin(requestId);
    // Same id, so the new answer streams into the old one's place.
    setItems((prev) =>
      prev.map((item) =>
        item.id === previous.id ? { id: previous.id, role: "assistant", text: "", requestId } : item
      )
    );
    const reply = await window.api.assistant.regenerate(chatId, requestId);
    setItems((prev) =>
      prev.flatMap((item) => {
        if (item.id !== previous.id) return [item];
        if (reply.ok) return [finalItem(previous.id, reply)];
        // A failed retry keeps the answer you already had (main restored it)
        // and says why the retry didn't happen.
        return [previous, finalItem(nextId.current++, reply)];
      })
    );
    afterReply(reply);
  }, [afterReply, begin]);

  const stop = useCallback((): void => {
    if (activeRequest.current) void window.api.assistant.stop(activeRequest.current);
  }, []);

  const answerApproval = useCallback((approvalId: string, allow: boolean, allowedItems?: string[]): void => {
    setItems((prev) =>
      prev.map((item) =>
        item.approvals?.some((a) => a.approvalId === approvalId)
          ? { ...item, approvals: item.approvals.filter((a) => a.approvalId !== approvalId) }
          : item
      )
    );
    void window.api.assistant.approve(approvalId, allow, allowedItems);
  }, []);

  // Summarizes the older part of the open chat now. Failures show as an error
  // line (the chat itself is untouched).
  const compact = useCallback(async (): Promise<void> => {
    const chatId = conversationIdRef.current;
    if (!chatId || busyRef.current) return;
    begin("compact");
    const result = await window.api.assistant.chats.compact(chatId);
    end();
    if (result.ok) {
      await openChat(chatId);
    } else {
      setItems((prev) => [
        ...prev,
        { id: nextId.current++, role: "error", text: result.reason ?? "Couldn't summarize this chat" },
      ]);
    }
  }, [begin, end, openChat]);

  const reset = useCallback((): void => {
    if (busyRef.current) return;
    setConversation(null);
    setTitle(null);
    setUsage(NO_USAGE);
    setItems([]);
  }, [setConversation]);

  return {
    items,
    busy,
    conversationId,
    title,
    usage,
    send,
    stop,
    regenerate,
    compact,
    answerApproval,
    reset,
    openChat,
  };
}

export type AssistantChatState = ReturnType<typeof useAssistantChat>;
