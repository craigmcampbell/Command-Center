import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { AssistantToolCall, CaptureTarget } from "../../../shared/types";
import { ASSISTANT_MUTATING_TOOLS } from "../../../shared/assistant";
import { renderMarkdown } from "../lib/markdown";
import { handleMarkdownPreviewClick } from "../lib/markdownPreviewInteractions";
import { chatToMarkdown, replyToMarkdown } from "../lib/assistantMarkdown";
import type { AssistantChatState, ChatItem, LiveTool } from "../hooks/useAssistantChat";
import { IconCheck, IconCopy, IconX } from "./icons";

// The transcript and composer for one Assistant conversation. Used by the
// dashboard tab and the quick panel; the surrounding chrome (history, memory,
// window frame) belongs to those, not here.
//
// Assistant replies render as markdown through lib/markdown.ts, which escapes
// any raw HTML in the source and runs every link through safeUrl — the same
// renderer the notes preview and Todoist descriptions use, so model output gets
// no looser treatment than a pasted note. User messages and errors stay plain
// text children.

const TOOL_LABELS: Record<string, string> = {
  get_due_tasks: "Todoist",
  get_schedule: "Calendar",
  docker_status: "Docker",
  github_status: "GitHub",
  git_status: "Git",
  ynab_unapproved: "YNAB",
  search_notes: "Notes search",
  read_note: "Note",
  complete_task: "Completed task",
  reschedule_task: "Rescheduled task",
  create_task: "Created task",
  remember: "Memory",
  forget: "Memory",
};

// What the assistant is doing while a call runs, and the same thing once done.
const TOOL_ACTIVITY: Record<string, { doing: string; done: string }> = {
  get_due_tasks: { doing: "Checking Todoist", done: "Checked Todoist" },
  get_schedule: { doing: "Reading your calendar", done: "Read your calendar" },
  docker_status: { doing: "Checking Docker", done: "Checked Docker" },
  github_status: { doing: "Checking GitHub", done: "Checked GitHub" },
  git_status: { doing: "Checking local repos", done: "Checked local repos" },
  ynab_unapproved: { doing: "Checking YNAB", done: "Checked YNAB" },
  search_notes: { doing: "Searching your notes", done: "Searched your notes" },
  read_note: { doing: "Reading a note", done: "Read a note" },
  complete_task: { doing: "Completing a task", done: "Completed a task" },
  reschedule_task: { doing: "Rescheduling a task", done: "Rescheduled a task" },
  create_task: { doing: "Creating a task", done: "Created a task" },
  remember: { doing: "Saving to memory", done: "Saved to memory" },
  forget: { doing: "Editing memory", done: "Edited memory" },
};

const SAVE_TARGETS: { id: CaptureTarget; label: string }[] = [
  { id: "dailyNote", label: "Daily note" },
  { id: "scratchpad", label: "Scratchpad" },
];

function formatTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatUsage(usage: { promptTokens: number; completionTokens: number; costUsd: number | null }): string | null {
  const total = usage.promptTokens + usage.completionTokens;
  if (total === 0) return null;
  const cost = usage.costUsd === null ? "" : ` · $${usage.costUsd < 0.01 ? usage.costUsd.toFixed(4) : usage.costUsd.toFixed(2)}`;
  return `${formatTokens(total)} tokens${cost}`;
}

interface AssistantChatProps {
  chat: AssistantChatState;
  onOpenSettings: () => void;
  emptyState?: ReactNode;
  // Bump to move keyboard focus into the composer (the quick panel does this
  // each time it is summoned; the window's own focus event isn't enough because
  // React never remounts between summons).
  focusToken?: number;
}

export default function AssistantChat({ chat, onOpenSettings, emptyState, focusToken }: AssistantChatProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { items, busy } = chat;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items, busy]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusToken]);

  // Refocus after a reply lands (the box is disabled while one is in flight, and
  // a disabled element drops focus).
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void chat.send(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  // Each reply needs the question that prompted it (for "Save to notes").
  const rows = useMemo(() => {
    let lastQuestion: string | null = null;
    let lastAssistant = -1;
    items.forEach((item, i) => {
      if (item.role === "assistant" && !item.requestId) lastAssistant = i;
    });
    return items.map((item, i) => {
      if (item.role === "user") lastQuestion = item.text;
      return { item, question: lastQuestion, isLastAssistant: i === lastAssistant };
    });
  }, [items]);

  return (
    <div className="assistant-main">
      <div className="assistant-log" role="log" aria-live="polite" aria-busy={busy}>
        {items.length === 0 && (emptyState ?? <p className="muted">Ask me anything.</p>)}
        {rows.map(({ item, question, isLastAssistant }) => (
          <MessageRow
            key={item.id}
            item={item}
            question={question}
            canRegenerate={
              isLastAssistant &&
              !busy &&
              chat.conversationId !== null &&
              !item.toolCalls?.some((c) => ASSISTANT_MUTATING_TOOLS.has(c.name))
            }
            onRegenerate={() => void chat.regenerate()}
            onApprove={chat.answerApproval}
            onOpenSettings={onOpenSettings}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="assistant-input-row">
        <textarea
          ref={inputRef}
          className="assistant-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything…  (Enter to send, Shift+Enter for a new line)"
          rows={2}
          disabled={busy}
          autoFocus
        />
        {busy ? (
          <button type="button" className="assistant-stop" onClick={chat.stop}>
            Stop
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={!draft.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

interface MessageRowProps {
  item: ChatItem;
  question: string | null;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onApprove: (approvalId: string, allow: boolean) => void;
  onOpenSettings: () => void;
}

function MessageRow({ item, question, canRegenerate, onRegenerate, onApprove, onOpenSettings }: MessageRowProps) {
  // Re-parsed on every streamed delta, which is cheap at chat-reply sizes; the
  // memo just keeps unrelated re-renders (typing in the input) from redoing it.
  // An unclosed fence or list mid-stream renders as-is and tidies itself as the
  // rest arrives. Computed before any early return to keep hook order stable.
  const html = useMemo(
    () => (item.role === "assistant" ? renderMarkdown(item.text) : ""),
    [item.role, item.text]
  );

  const pending = Boolean(item.requestId);
  const approvals = item.approvals ?? [];

  const liveTools = item.liveTools ?? [];
  const anyRunning = liveTools.some((t) => t.status === "running");

  // A reply that hasn't produced its first token yet shows what it is doing
  // instead of an empty bubble: the tool calls in flight, or a waiting/thinking line.
  if (pending && !item.text) {
    return (
      <div className="assistant-msg">
        {approvals.length > 0 && <p className="muted assistant-thinking">Waiting for your OK…</p>}
        {approvals.length === 0 && !anyRunning && <p className="muted assistant-thinking">Thinking…</p>}
        <LiveTools tools={liveTools} />
        <ApprovalCards approvals={approvals} onApprove={onApprove} />
      </div>
    );
  }

  return (
    <div className={`assistant-msg assistant-msg-${item.role}`}>
      {item.role === "assistant" ? (
        <div
          className="assistant-bubble assistant-bubble-md note"
          onClick={(e) => handleMarkdownPreviewClick(e, {})}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="assistant-bubble">{item.text}</div>
      )}
      {pending && <LiveTools tools={liveTools} />}
      <ApprovalCards approvals={approvals} onApprove={onApprove} />
      {item.needsSetup && (
        <button type="button" className="assistant-setup-button" onClick={onOpenSettings}>
          Open Assistant settings
        </button>
      )}
      {Boolean(item.toolCalls?.length || item.remembered?.length) && (
        <div className="assistant-chips">
          {item.toolCalls?.map((call, i) => (
            <span key={i} className={`assistant-chip${call.ok ? "" : " assistant-chip-bad"}`}>
              {TOOL_LABELS[call.name] ?? call.name}
              {call.ok ? "" : call.declined ? " declined" : " failed"}
            </span>
          ))}
          {item.remembered?.map((fact, i) => (
            <span key={`m${i}`} className="assistant-chip assistant-chip-memory">
              Remembered: {fact}
            </span>
          ))}
        </div>
      )}
      {!pending && Boolean(item.toolCalls?.length) && <ToolLog calls={item.toolCalls!} />}
      {item.role === "assistant" && !pending && (
        <ReplyActions
          text={item.text}
          question={question}
          canRegenerate={canRegenerate}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
}

// Ticks once a second while something is running, so elapsed times advance
// without a timer per row and nothing runs when everything is idle.
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function StatusIcon({ status }: { status: LiveTool["status"] }) {
  if (status === "running") return <span className="assistant-spinner" aria-label="Running" />;
  return status === "done" ? <IconCheck size={11} /> : <IconX size={10} />;
}

// What the assistant is doing right now, one line per call. Appears under (or in
// place of) the streaming bubble and is replaced by the finished reply's chips.
function LiveTools({ tools }: { tools: LiveTool[] }) {
  const now = useNow(tools.some((t) => t.status === "running"));
  if (tools.length === 0) return null;
  return (
    <ul className="assistant-live-tools" aria-label="Tool activity">
      {tools.map((tool) => {
        const activity = TOOL_ACTIVITY[tool.name];
        const label = tool.status === "running" ? (activity?.doing ?? tool.name) : (activity?.done ?? tool.name);
        const seconds = Math.floor((now - tool.startedAt) / 1000);
        return (
          <li key={tool.callId} className={`assistant-live-tool assistant-live-${tool.status}`}>
            <StatusIcon status={tool.status} />
            <span>
              {label}
              {tool.status === "failed" && " — failed"}
              {tool.status === "declined" && " — declined"}
              {tool.status === "running" && "…"}
            </span>
            {tool.args && <span className="muted assistant-live-args">{tool.args}</span>}
            {tool.status === "running" && seconds >= 2 && <span className="muted">{seconds}s</span>}
          </li>
        );
      })}
    </ul>
  );
}

// Everything the assistant called while producing a reply, with what it asked
// for and what came back. Rebuilt from the saved messages, so it is the same
// after the chat is reopened.
function ToolLog({ calls }: { calls: AssistantToolCall[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="assistant-tool-log">
      <button
        type="button"
        className="assistant-link"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} tool details ({calls.length})
      </button>
      {open && (
        <ul className="assistant-tool-log-list">
          {calls.map((call, i) => (
            <li key={i} className={`assistant-tool-entry${call.ok ? "" : " assistant-tool-entry-bad"}`}>
              <div className="assistant-tool-entry-head">
                <StatusIcon status={call.ok ? "done" : call.declined ? "declined" : "failed"} />
                <span className="assistant-tool-entry-name">{TOOL_LABELS[call.name] ?? call.name}</span>
                <code>{call.name}</code>
                {!call.ok && <span className="assistant-tool-entry-state">{call.declined ? "declined" : "failed"}</span>}
              </div>
              {call.args && <div className="assistant-tool-entry-args">{call.args}</div>}
              {call.result && (
                <details className="assistant-tool-entry-result">
                  <summary>{call.ok ? "Result" : "Error"}</summary>
                  <pre>{call.result}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApprovalCards({
  approvals,
  onApprove,
}: {
  approvals: NonNullable<ChatItem["approvals"]>;
  onApprove: (approvalId: string, allow: boolean) => void;
}) {
  return (
    <>
      {approvals.map((approval) => (
        <div key={approval.approvalId} className="assistant-approval" role="group" aria-label="Confirm action">
          <p>
            <span className="assistant-approval-label">The assistant wants to</span>
            {approval.summary}
          </p>
          <div className="assistant-approval-actions">
            <button type="button" onClick={() => onApprove(approval.approvalId, true)}>
              Allow
            </button>
            <button type="button" className="assistant-approval-deny" onClick={() => onApprove(approval.approvalId, false)}>
              Deny
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function ReplyActions({
  text,
  question,
  canRegenerate,
  onRegenerate,
}: {
  text: string;
  question: string | null;
  canRegenerate: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className="assistant-reply-actions">
      <button type="button" className="assistant-link" onClick={copy} aria-label="Copy reply">
        {copied ? <IconCheck /> : <IconCopy />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      {canRegenerate && (
        <button type="button" className="assistant-link" onClick={onRegenerate}>
          Regenerate
        </button>
      )}
      <SaveToNotes build={() => replyToMarkdown(question, text)} label="Save" />
    </div>
  );
}

// Reveals the two capture targets inline, then reports the outcome. Goes
// through the same `capture.submit` as the Quick Capture panel, which also tells
// the owning widget to drop its stale buffer so the next autosave can't erase
// what was just appended.
export function SaveToNotes({ build, label }: { build: () => string; label: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save(target: CaptureTarget) {
    setOpen(false);
    const result = await window.api.capture.submit(target, build());
    setStatus(result.ok ? "Saved" : (result.reason ?? "Couldn't save"));
    window.setTimeout(() => setStatus(null), 2500);
  }

  if (status) return <span className="muted assistant-save-status">{status}</span>;
  if (!open) {
    return (
      <button type="button" className="assistant-link" onClick={() => setOpen(true)} aria-expanded={false}>
        {label} to…
      </button>
    );
  }
  return (
    <span className="assistant-save-menu">
      {SAVE_TARGETS.map((t) => (
        <button key={t.id} type="button" className="assistant-link" onClick={() => void save(t.id)}>
          {t.label}
        </button>
      ))}
      <button type="button" className="assistant-link" onClick={() => setOpen(false)} aria-label="Cancel">
        ×
      </button>
    </span>
  );
}

// Used by the tab header: a whole conversation as one markdown block.
export function chatMarkdown(chat: AssistantChatState): string {
  const firstQuestion = chat.items.find((i) => i.role === "user")?.text ?? null;
  return chatToMarkdown(chat.title ?? firstQuestion, chat.items);
}
