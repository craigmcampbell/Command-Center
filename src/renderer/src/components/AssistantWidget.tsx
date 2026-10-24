import { useEffect, useRef, useState } from "react";
import type { AssistantChatSummary, AssistantUsage } from "../../../shared/types";
import { diffMemory, type MemoryDiff } from "../../../shared/memoryDiff";
import { useAssistantChat } from "../hooks/useAssistantChat";
import AssistantChat, { chatMarkdown, formatUsage, SaveToNotes } from "./AssistantChat";
import Panel from "./Panel";
import { IconPencil, IconPin, IconTrash } from "./icons";

// The Assistant tab: the chat (shared with the quick panel) plus what only the
// dashboard has room for — saved-chat history with search, pinning, renaming
// and delete, and the memory editor.

// Today shows the time, anything older the date — enough to tell chats apart
// without a relative-time library.
function formatWhen(ms: number): string {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface AssistantWidgetProps {
  onOpenSettings: () => void;
  // A chat the quick panel asked the dashboard to show ("Open in dashboard").
  pendingOpenChatId?: string | null;
  onPendingOpenHandled?: () => void;
  // Changes when something outside this component altered the history list
  // (an AI-written title landing), so it should reload.
  refreshToken?: number;
}

export default function AssistantWidget({
  onOpenSettings,
  pendingOpenChatId,
  onPendingOpenHandled,
  refreshToken,
}: AssistantWidgetProps) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [chats, setChats] = useState<AssistantChatSummary[]>([]);
  const [query, setQuery] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Which rename is live, readable synchronously. Enter commits directly and
  // unmounting the input can also fire blur, so the second call must find
  // nothing left to commit instead of renaming twice.
  const renamingRef = useRef<string | null>(null);

  // The list is refreshed from callbacks that outlive a render (after a reply
  // lands), so it reads the live query from a ref rather than a stale closure.
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // Array.isArray guards a malformed reply from the bridge; the list is cosmetic,
  // so an unexpected shape should show an empty history, not crash.
  async function refreshChats() {
    const list = await window.api.assistant.chats.list(queryRef.current.trim() || undefined);
    setChats(Array.isArray(list) ? list : []);
  }

  const chat = useAssistantChat({ onSaved: () => void refreshChats() });

  // Debounced so typing doesn't query on every keystroke. Also the initial load.
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshChats(), query ? 200 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (refreshToken) void refreshChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    if (!pendingOpenChatId) return;
    void chat.openChat(pendingOpenChatId).then(() => onPendingOpenHandled?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenChatId]);

  // Starting a new chat only detaches this view; the old chat is already saved
  // and stays in the history list.
  function newChat() {
    chat.reset();
    setConfirmingId(null);
    cancelRename();
  }

  async function openChat(id: string) {
    if (chat.busy || id === chat.conversationId) return;
    const opened = await chat.openChat(id);
    if (!opened) void refreshChats(); // gone since the list was fetched
    setConfirmingId(null);
  }

  async function removeChat(id: string) {
    setConfirmingId(null);
    await window.api.assistant.chats.remove(id);
    if (id === chat.conversationId) newChat();
    void refreshChats();
  }

  function cancelRename() {
    renamingRef.current = null;
    setRenamingId(null);
  }

  async function commitRename(id: string) {
    if (renamingRef.current !== id) return;
    renamingRef.current = null;
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    await window.api.assistant.chats.rename(id, title);
    void refreshChats();
  }

  async function togglePin(target: AssistantChatSummary) {
    await window.api.assistant.chats.pin(target.id, !target.pinned);
    void refreshChats();
  }

  const usageText = formatUsage(chat.usage);

  return (
    <Panel
      title="Assistant"
      headerRight={
        <div className="assistant-header-actions">
          {usageText && (
            <span className="muted assistant-usage" title="Tokens and cost for this chat">
              {usageText}
            </span>
          )}
          <button type="button" className="assistant-link" onClick={onOpenSettings}>
            Settings
          </button>
          <button
            type="button"
            className="assistant-link"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
          >
            History
          </button>
          <button
            type="button"
            className="assistant-link"
            onClick={() => setMemoryOpen((o) => !o)}
            aria-expanded={memoryOpen}
          >
            Memory
          </button>
          {chat.items.some((i) => i.role !== "error" && i.text) && !chat.busy && (
            <SaveToNotes build={() => chatMarkdown(chat)} label="Save chat" />
          )}
          {chat.conversationId && (
            <button
              type="button"
              className="assistant-link"
              onClick={() => void chat.compact()}
              disabled={chat.busy}
              title="Summarize the older part of this chat to cut what is re-sent each turn"
            >
              Compact
            </button>
          )}
          <button
            type="button"
            className="assistant-link"
            onClick={newChat}
            disabled={chat.busy || (chat.items.length === 0 && !chat.conversationId)}
          >
            New chat
          </button>
        </div>
      }
    >
      <div className="assistant-layout">
        {historyOpen && (
          <aside className="assistant-history" aria-label="Chat history">
            <input
              className="assistant-history-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              aria-label="Search chats"
            />
            {chats.length === 0 ? (
              <p className="muted">{query.trim() ? "No chats match." : "Past chats appear here."}</p>
            ) : (
              <ul className="assistant-chat-list">
                {chats.map((item) => (
                  <li
                    key={item.id}
                    className={`assistant-chat${item.id === chat.conversationId ? " active" : ""}`}
                  >
                    {renamingId === item.id ? (
                      <input
                        className="assistant-chat-rename"
                        value={renameValue}
                        autoFocus
                        maxLength={120}
                        aria-label="Chat title"
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void commitRename(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(item.id);
                          if (e.key === "Escape") cancelRename();
                        }}
                      />
                    ) : confirmingId === item.id ? (
                      <div className="assistant-chat-confirm">
                        <span>Delete this chat?</span>
                        <button type="button" onClick={() => void removeChat(item.id)}>
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirmingId(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="assistant-chat-open"
                          onClick={() => void openChat(item.id)}
                          disabled={chat.busy}
                          aria-current={item.id === chat.conversationId ? "true" : undefined}
                        >
                          <span className="assistant-chat-title">
                            {item.pinned && <IconPin size={11} className="assistant-chat-pin" />}
                            {item.title}
                          </span>
                          <span className="assistant-chat-when">{formatWhen(item.updatedAt)}</span>
                        </button>
                        <span className="assistant-chat-actions">
                          <button
                            type="button"
                            onClick={() => void togglePin(item)}
                            disabled={chat.busy}
                            aria-label={`${item.pinned ? "Unpin" : "Pin"} chat: ${item.title}`}
                            aria-pressed={item.pinned}
                            title={item.pinned ? "Unpin" : "Pin to top"}
                          >
                            <IconPin />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenameValue(item.title);
                              renamingRef.current = item.id;
                              setRenamingId(item.id);
                            }}
                            disabled={chat.busy}
                            aria-label={`Rename chat: ${item.title}`}
                            title="Rename"
                          >
                            <IconPencil />
                          </button>
                          <button
                            type="button"
                            className="assistant-chat-delete"
                            onClick={() => setConfirmingId(item.id)}
                            disabled={chat.busy}
                            aria-label={`Delete chat: ${item.title}`}
                            title="Delete chat"
                          >
                            <IconTrash />
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
        <AssistantChat
          chat={chat}
          onOpenSettings={onOpenSettings}
          emptyState={
            <p className="muted">
              Ask about your tasks, schedule, notes, repos or Docker. I can complete, reschedule and
              create tasks (you'll be asked to confirm). Say "remember …" to save something for
              future chats.
            </p>
          }
        />
        {memoryOpen && <MemoryPane />}
      </div>
    </Panel>
  );
}

type TidyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unchanged" }
  | { status: "error"; message: string }
  // `before` is the file as the model saw it; applying is refused if the file
  // on disk no longer matches it.
  | { status: "ready"; before: string; proposed: string; diff: MemoryDiff; usage?: AssistantUsage };

function MemoryPane() {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [file, setFile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tidy, setTidy] = useState<TidyState>({ status: "idle" });
  // After applying a tidy: what to put back, and what the file must still equal
  // for that to be safe (anything else changed it since).
  const [undo, setUndo] = useState<{ restore: string; applied: string } | null>(null);

  useEffect(() => {
    void window.api.assistant.memory.get().then((r) => {
      setContent(r.content);
      setSaved(r.content);
      setFile(r.path);
      setError(r.ok ? null : (r.reason ?? "Couldn't load memory"));
      setLoaded(true);
    });
  }, []);

  async function save() {
    setSaving(true);
    const r = await window.api.assistant.memory.save(content);
    setSaving(false);
    setError(r.ok ? null : (r.reason ?? "Couldn't save memory"));
    if (r.ok) {
      setSaved(content);
      setUndo(null);
    }
  }

  async function runTidy() {
    setTidy({ status: "loading" });
    setUndo(null);
    const r = await window.api.assistant.memory.tidy();
    if (!r.ok) setTidy({ status: "error", message: r.reason ?? "Couldn't tidy memory" });
    else if (!r.changed) setTidy({ status: "unchanged" });
    else {
      setTidy({
        status: "ready",
        before: r.current,
        proposed: r.proposed,
        diff: diffMemory(r.current, r.proposed),
        usage: r.usage,
      });
    }
  }

  // Writing is the user's decision, and only if nothing else touched the file
  // while the model was thinking (a `remember`, or an edit in Obsidian).
  async function applyTidy() {
    if (tidy.status !== "ready") return;
    const now = await window.api.assistant.memory.get();
    if (!now.ok || now.content !== tidy.before) {
      setTidy({ status: "error", message: "Memory changed while the tidy was being prepared. Run it again." });
      return;
    }
    const r = await window.api.assistant.memory.save(tidy.proposed);
    if (!r.ok) {
      setTidy({ status: "error", message: r.reason ?? "Couldn't save memory" });
      return;
    }
    setContent(tidy.proposed);
    setSaved(tidy.proposed);
    setUndo({ restore: tidy.before, applied: tidy.proposed });
    setTidy({ status: "idle" });
  }

  async function undoTidy() {
    if (!undo) return;
    const now = await window.api.assistant.memory.get();
    if (!now.ok || now.content !== undo.applied) {
      setUndo(null);
      setTidy({ status: "error", message: "Memory has changed since the tidy, so it can't be undone safely." });
      return;
    }
    const r = await window.api.assistant.memory.save(undo.restore);
    if (r.ok) {
      setContent(undo.restore);
      setSaved(undo.restore);
    } else {
      setError(r.reason ?? "Couldn't restore memory");
    }
    setUndo(null);
  }

  const dirty = content !== saved;
  const reviewing = tidy.status === "ready";

  return (
    <aside className="assistant-memory">
      <h3>Memory</h3>
      <p className="settings-card-hint">
        Read once when a chat starts, so edits apply from the next new chat.
      </p>
      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : reviewing ? (
        <div className="assistant-tidy-preview">
          <p className="assistant-tidy-summary">
            Proposed tidy: remove {tidy.diff.removed.length}, add {tidy.diff.added.length}, keep{" "}
            {tidy.diff.kept}
          </p>
          {tidy.diff.removed.length > 0 && (
            <ul className="assistant-tidy-lines assistant-tidy-removed" aria-label="Lines to remove">
              {tidy.diff.removed.map((line, i) => (
                <li key={i}>
                  <del>{line}</del>
                </li>
              ))}
            </ul>
          )}
          {tidy.diff.added.length > 0 && (
            <ul className="assistant-tidy-lines assistant-tidy-added" aria-label="Lines to add">
              {tidy.diff.added.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {tidy.usage && formatUsage(tidy.usage) && (
            <p className="muted assistant-tidy-usage">Used {formatUsage(tidy.usage)}</p>
          )}
          <div className="assistant-tidy-actions">
            <button type="button" onClick={() => void applyTidy()}>
              Apply
            </button>
            <button type="button" onClick={() => setTidy({ status: "idle" })}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <>
          <textarea
            className="assistant-memory-text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            placeholder="Nothing remembered yet."
          />
          {error && <p className="assistant-memory-error">{error}</p>}
          {tidy.status === "loading" && <p className="muted assistant-tidy-note">Asking the model to tidy…</p>}
          {tidy.status === "unchanged" && <p className="muted assistant-tidy-note">Memory is already tidy.</p>}
          {tidy.status === "error" && <p className="assistant-memory-error">{tidy.message}</p>}
          {undo && (
            <p className="muted assistant-tidy-note">
              Tidied.{" "}
              <button type="button" className="assistant-link" onClick={() => void undoTidy()}>
                Undo
              </button>
            </p>
          )}
          <div className="assistant-memory-tools">
            <button
              type="button"
              className="assistant-link"
              onClick={() => void runTidy()}
              disabled={tidy.status === "loading" || dirty || !saved.trim()}
              title={
                dirty
                  ? "Save your edits first — tidy works on the saved file"
                  : "Merge duplicates and drop superseded facts (you review it first)"
              }
            >
              Tidy with AI
            </button>
          </div>
          <div className="assistant-memory-footer">
            <span className="muted assistant-memory-path" title={file}>
              {file}
            </span>
            <button type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
