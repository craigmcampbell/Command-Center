import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { AssistantToolCall, CaptureTarget } from "../../../shared/types";
import { ASSISTANT_MUTATING_TOOLS } from "../../../shared/assistant";
import { renderMarkdown } from "../lib/markdown";
import { handleMarkdownPreviewClick } from "../lib/markdownPreviewInteractions";
import { chatToMarkdown, replyToMarkdown } from "../lib/assistantMarkdown";
import type { AssistantApproval, AssistantCommandInfo } from "../../../shared/types";
import { matchCommands } from "../lib/commandMatch";
import { describeSize, MAX_FILES, MAX_TOTAL_BYTES, readAttachment, type PendingAttachment } from "../lib/attachments";
import type { AssistantChatState, ChatItem, LiveTool } from "../hooks/useAssistantChat";
import Menu from "./Menu";
import { IconArrowUp, IconCheck, IconCopy, IconPlus, IconX } from "./icons";

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
  github_list_prs: "Pull requests",
  ynab_unapproved: "YNAB",
  ynab_categories: "YNAB categories",
  approve_transaction: "Approved transaction",
  categorize_transaction: "Categorised transaction",
  reader_feed_unread: "Reader feed",
  reader_save_link: "Saved to Reader",
  reader_move_to_inbox: "Moved to inbox",
  search_notes: "Notes search",
  read_note: "Note",
  complete_task: "Completed task",
  reschedule_task: "Rescheduled task",
  create_task: "Created task",
  web_search: "Web search",
  web_scrape: "Web page",
  recall_memory: "Memory lookup",
  generate_image: "Image",
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
  github_list_prs: { doing: "Listing pull requests", done: "Listed pull requests" },
  ynab_unapproved: { doing: "Checking YNAB", done: "Checked YNAB" },
  ynab_categories: { doing: "Reading YNAB categories", done: "Read YNAB categories" },
  approve_transaction: { doing: "Approving a transaction", done: "Approved a transaction" },
  categorize_transaction: { doing: "Categorising a transaction", done: "Categorised a transaction" },
  reader_feed_unread: { doing: "Reading your Reader feed", done: "Read your Reader feed" },
  reader_save_link: { doing: "Saving to Reader", done: "Saved to Reader" },
  reader_move_to_inbox: { doing: "Moving to the Reader inbox", done: "Moved to the Reader inbox" },
  search_notes: { doing: "Searching your notes", done: "Searched your notes" },
  read_note: { doing: "Reading a note", done: "Read a note" },
  complete_task: { doing: "Completing a task", done: "Completed a task" },
  reschedule_task: { doing: "Rescheduling a task", done: "Rescheduled a task" },
  create_task: { doing: "Creating a task", done: "Created a task" },
  web_search: { doing: "Searching the web", done: "Searched the web" },
  web_scrape: { doing: "Reading a web page", done: "Read a web page" },
  recall_memory: { doing: "Searching your memory", done: "Searched your memory" },
  generate_image: { doing: "Generating an image", done: "Generated an image" },
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

  // Slash commands: enabled skills and saved prompts, offered while the draft
  // is just "/" plus the start of a name.
  const [commands, setCommands] = useState<AssistantCommandInfo[]>([]);
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const loadCommands = useCallback(() => {
    void window.api.assistant.commands
      .list()
      .then(setCommands)
      .catch(() => setCommands([]));
  }, []);
  useEffect(loadCommands, [loadCommands, focusToken]);
  useEffect(() => {
    // Picks up a skill switched on in Settings without a reload.
    window.addEventListener("focus", loadCommands);
    return () => window.removeEventListener("focus", loadCommands);
  }, [loadCommands]);

  const typedName = /^\/([\w-]*)$/.exec(draft)?.[1] ?? null;
  const matches = useMemo(
    () => (typedName === null ? [] : matchCommands(commands, typedName)),
    [commands, typedName]
  );
  const pickerOpen = matches.length > 0 && !busy && !dismissed;
  useEffect(() => {
    setPick(0);
    setDismissed(false);
  }, [typedName]);

  // Attachments: pasted, dropped or picked, shown as chips until sent.
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: File[]) {
    if (busy || files.length === 0) return;
    setAttachError(null);
    const added: PendingAttachment[] = [];
    for (const file of files) {
      const current = [...pendingRef.current, ...added];
      if (current.length >= MAX_FILES) {
        setAttachError(`Attach at most ${MAX_FILES} files at a time`);
        break;
      }
      const result = await readAttachment(file);
      if (typeof result === "string") {
        setAttachError(result);
        continue;
      }
      if (current.reduce((n, a) => n + a.size, result.size) > MAX_TOTAL_BYTES) {
        setAttachError("Those files are too large together");
        if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
        break;
      }
      added.push(result);
    }
    if (added.length) setPending((prev) => [...prev, ...added]);
  }

  function removePending(key: string) {
    setPending((prev) => {
      const gone = prev.find((a) => a.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.key !== key);
    });
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return; // ordinary text paste
    e.preventDefault();
    void addFiles(files);
  }

  function complete(command: AssistantCommandInfo) {
    setDraft(`/${command.name} `);
    inputRef.current?.focus();
  }

  function submit() {
    const text = draft.trim();
    if ((!text && pending.length === 0) || busy) return;
    const files = pending;
    setPending([]);
    setAttachError(null);
    // "/name rest" runs that command if it's enabled; anything else (a path,
    // an unknown word) is just text.
    const parsed = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text);
    const command = parsed && commands.find((c) => c.name.toLowerCase() === parsed[1].toLowerCase());
    setDraft("");
    if (command) void chat.send(parsed?.[2] ?? "", command.name, files);
    else void chat.send(text, undefined, files);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setPick((p) => (p + step + matches.length) % matches.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
      const chosen = matches[Math.min(pick, matches.length - 1)];
      // Enter on a name that is already complete runs it; otherwise it completes it.
      if ((e.key === "Tab" || e.key === "Enter") && chosen && chosen.name !== typedName && !e.nativeEvent.isComposing) {
        e.preventDefault();
        complete(chosen);
        return;
      }
    }
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
    <div
      className={`assistant-main${dragging ? " is-dragging" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles([...e.dataTransfer.files]);
      }}
    >
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
      {(pending.length > 0 || attachError) && (
        <div className="assistant-attachments" aria-label="Attachments">
          {pending.map((a) => (
            <span key={a.key} className="assistant-attachment-chip" title={`${a.name} · ${describeSize(a.size)}`}>
              {a.previewUrl ? <img src={a.previewUrl} alt="" /> : <span className="assistant-file-icon">TXT</span>}
              <span className="assistant-attachment-name">{a.name}</span>
              <button type="button" onClick={() => removePending(a.key)} aria-label={`Remove ${a.name}`}>
                ×
              </button>
            </span>
          ))}
          {attachError && <span className="assistant-attach-error">{attachError}</span>}
        </div>
      )}
      <div className="assistant-input-row">
        {pickerOpen && (
          <ul className="assistant-command-picker" role="listbox" aria-label="Commands">
            {matches.map((c, i) => (
              <li
                key={c.name}
                role="option"
                aria-selected={i === pick}
                className={i === pick ? "is-active" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  complete(c);
                }}
              >
                <strong>/{c.name}</strong>
                {c.description && <span className="muted"> {c.description}</span>}
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={inputRef}
          className="assistant-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask anything…  (Enter to send, / for commands, paste or drop files)"
          rows={2}
          disabled={busy}
          autoFocus
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="assistant-attach-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-label="Attach files"
          title="Attach images or text files (or paste or drop them)"
        >
          <IconPlus size={16} />
        </button>
        {busy ? (
          <button type="button" className="assistant-stop" onClick={chat.stop}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="assistant-send"
            onClick={submit}
            disabled={!draft.trim() && pending.length === 0}
          >
            Send
            <IconArrowUp size={13} />
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
  onApprove: (approvalId: string, allow: boolean, allowedItems?: string[]) => void;
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

  // Where older messages were folded into a summary. They are still above (and
  // searchable); the model reads this in their place.
  if (item.role === "summary") {
    return (
      <details className="assistant-summary">
        <summary>Earlier messages were summarized to save space</summary>
        <p>{item.text}</p>
      </details>
    );
  }

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
        <div className="assistant-bubble">
          {item.attachments?.length ? (
            <div className="assistant-sent-attachments">
              {item.attachments.map((a) => (
                <SentAttachment key={a.id} attachment={a} />
              ))}
            </div>
          ) : null}
          {item.command && <span className="assistant-command-chip">/{item.command}</span>}
          {item.command && item.text ? " " : ""}
          {item.text}
        </div>
      )}
      {item.role === "assistant" && item.attachments?.length ? (
        <div className="assistant-generated">
          {item.attachments.map((a) => (
            <GeneratedImage key={a.id} attachment={a} />
          ))}
        </div>
      ) : null}
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
      {approvals.map((approval) =>
        approval.items ? (
          <BatchApprovalCard key={approval.approvalId} approval={approval} onApprove={onApprove} />
        ) : (
          <div key={approval.approvalId} className="assistant-approval" role="group" aria-label="Confirm action">
            <p>
              <span className="assistant-approval-label">The assistant wants to</span>
              {approval.summary}
            </p>
            <div className="assistant-approval-actions">
              <button type="button" className="assistant-approval-allow" onClick={() => onApprove(approval.approvalId, true)}>
                Allow
              </button>
              <button type="button" className="assistant-approval-deny" onClick={() => onApprove(approval.approvalId, false)}>
                Deny
              </button>
            </div>
          </div>
        )
      )}
    </>
  );
}

// Images already shown once are kept: a transcript re-renders on every streamed
// token, and each reopened chat would otherwise re-read the same files.
const imageCache = new Map<string, string | null>();

function SentAttachment({ attachment }: { attachment: NonNullable<ChatItem["attachments"]>[number] }) {
  const [url, setUrl] = useState<string | null | undefined>(
    attachment.previewUrl ?? imageCache.get(attachment.id)
  );
  useEffect(() => {
    if (attachment.kind !== "image" || url !== undefined) return;
    let live = true;
    void window.api.assistant.readAttachment(attachment.id).then((loaded) => {
      imageCache.set(attachment.id, loaded);
      if (live) setUrl(loaded);
    });
    return () => {
      live = false;
    };
  }, [attachment.id, attachment.kind, url]);

  if (attachment.kind === "text") {
    return (
      <span className="assistant-attachment-chip" title={attachment.name}>
        <span className="assistant-file-icon">TXT</span>
        <span className="assistant-attachment-name">{attachment.name}</span>
      </span>
    );
  }
  return url ? (
    <img className="assistant-sent-image" src={url} alt={attachment.name} title={attachment.name} />
  ) : (
    <span className="assistant-attachment-chip" title={attachment.name}>
      <span className="assistant-file-icon">IMG</span>
      <span className="assistant-attachment-name">{url === null ? `${attachment.name} (removed)` : attachment.name}</span>
    </span>
  );
}

// An image the assistant made, with a way to keep it.
function GeneratedImage({ attachment }: { attachment: NonNullable<ChatItem["attachments"]>[number] }) {
  const [note, setNote] = useState<string | null>(null);
  async function save() {
    const result = await window.api.assistant.saveAttachment(attachment.id, attachment.name);
    setNote(result.ok ? "Saved" : result.cancelled ? null : (result.reason ?? "Couldn't save"));
  }
  return (
    <figure className="assistant-generated-image">
      <SentAttachment attachment={attachment} />
      <figcaption>
        <button type="button" className="assistant-link" onClick={() => void save()}>
          Save image…
        </button>
        {note && <span className="muted"> {note}</span>}
      </figcaption>
    </figure>
  );
}

// Several changes from one step in a single card. Everything starts ticked, so
// the common answer is one click; unticking drops just that item (it reports
// back to the model as declined).
function BatchApprovalCard({
  approval,
  onApprove,
}: {
  approval: AssistantApproval;
  onApprove: (approvalId: string, allow: boolean, allowedItems?: string[]) => void;
}) {
  const items = approval.items ?? [];
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(items.map((i) => i.itemId)));
  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div className="assistant-approval" role="group" aria-label={`Confirm ${items.length} actions`}>
      <p>
        <span className="assistant-approval-label">The assistant wants to make {items.length} changes</span>
      </p>
      <ul className="assistant-approval-items">
        {items.map((item) => (
          <li key={item.itemId}>
            <label>
              <input type="checkbox" checked={ticked.has(item.itemId)} onChange={() => toggle(item.itemId)} />
              <span>{item.summary}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="assistant-approval-actions">
        <button
          type="button"
          className="assistant-approval-allow"
          disabled={ticked.size === 0}
          onClick={() => onApprove(approval.approvalId, true, [...ticked])}
        >
          {ticked.size === items.length ? "Allow all" : `Allow ${ticked.size} of ${items.length}`}
        </button>
        <button type="button" className="assistant-approval-deny" onClick={() => onApprove(approval.approvalId, false)}>
          Deny all
        </button>
      </div>
    </div>
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
export function SaveToNotes({
  build,
  label,
  disabled,
}: {
  build: () => string;
  label: string;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);

  async function save(target: CaptureTarget) {
    const result = await window.api.capture.submit(target, build());
    setStatus(result.ok ? "Saved" : (result.reason ?? "Couldn't save"));
    window.setTimeout(() => setStatus(null), 2500);
  }

  if (status) return <span className="muted assistant-save-status">{status}</span>;
  return (
    <Menu
      label={label}
      disabled={disabled}
      align="right"
      className="assistant-link"
      items={SAVE_TARGETS.map((t) => ({ key: t.id, label: t.label, onSelect: () => void save(t.id) }))}
    />
  );
}

// Used by the tab header: a whole conversation as one markdown block.
export function chatMarkdown(chat: AssistantChatState): string {
  const firstQuestion = chat.items.find((i) => i.role === "user")?.text ?? null;
  return chatToMarkdown(
    chat.title ?? firstQuestion,
    chat.items.filter(
      (i): i is ChatItem & { role: "user" | "assistant" | "error" } => i.role !== "summary"
    )
  );
}
