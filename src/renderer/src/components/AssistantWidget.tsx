import { useEffect, useRef, useState } from "react";
import type { AssistantChatSummary, AssistantFolder, AssistantUsage } from "../../../shared/types";
import { diffMemory, type MemoryDiff } from "../../../shared/memoryDiff";
import { useAssistantChat } from "../hooks/useAssistantChat";
import AssistantChat, { chatMarkdown, formatUsage, SaveToNotes } from "./AssistantChat";
import Menu from "./Menu";
import Panel from "./Panel";
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFolder,
  IconPencil,
  IconPin,
  IconPlus,
  IconTrash,
} from "./icons";

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

const ROOT = "__root__";
// The drag payload: a chat id. A private type, so dragging text or files in
// from outside never looks like a chat being filed.
const DRAG_TYPE = "text/x-assistant-chat";
const COLLAPSED_KEY = "assistant.collapsedFolders";

function loadCollapsed(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Remembering the folded state is a convenience.
  }
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
  const [folders, setFolders] = useState<AssistantFolder[]>([]);
  // Folders the user has folded shut; remembered between launches.
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // A folder id, or ROOT for the top level, while a chat is dragged over it.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderValue, setFolderValue] = useState("");
  const [confirmingFolderId, setConfirmingFolderId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
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
    const [list, folderList] = await Promise.all([
      window.api.assistant.chats.list(queryRef.current.trim() || undefined),
      window.api.assistant.folders.list(),
    ]);
    setChats(Array.isArray(list) ? list : []);
    setFolders(Array.isArray(folderList) ? folderList : []);
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

  // ---- folders ----

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      saveCollapsed(next);
      return next;
    });
  }

  async function createFolder() {
    const name = newFolderName.trim();
    setCreatingFolder(false);
    setNewFolderName("");
    if (!name) return;
    await window.api.assistant.folders.create(name);
    void refreshChats();
  }

  async function commitFolderRename(id: string) {
    const name = folderValue.trim();
    setRenamingFolderId(null);
    if (name) await window.api.assistant.folders.rename(id, name);
    void refreshChats();
  }

  async function removeFolder(id: string) {
    setConfirmingFolderId(null);
    await window.api.assistant.folders.remove(id);
    void refreshChats();
  }

  async function moveChat(id: string, folderId: string | null) {
    setMovingId(null);
    setDraggingId(null);
    setDropTarget(null);
    if (chats.find((c) => c.id === id)?.folderId === folderId) return;
    await window.api.assistant.chats.move(id, folderId);
    // A chat dropped into a folder shouldn't vanish behind a closed one.
    if (folderId && collapsed.has(folderId)) toggleFolder(folderId);
    void refreshChats();
  }

  // Drop handlers for a folder header, or for the top level (folderId null).
  function dropZone(folderId: string | null) {
    const key = folderId ?? ROOT;
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
      },
      onDrop: (e: React.DragEvent) => {
        const id = e.dataTransfer.getData(DRAG_TYPE) || draggingId;
        if (!id) return;
        e.preventDefault();
        void moveChat(id, folderId);
      },
    };
  }

  const searching = query.trim() !== "";
  const topLevel = searching ? chats : chats.filter((c) => !c.folderId);

  function renderChat(item: AssistantChatSummary) {
    return (
      <li
        key={item.id}
        className={`assistant-chat${item.id === chat.conversationId ? " active" : ""}${draggingId === item.id ? " dragging" : ""}`}
        draggable={renamingId !== item.id && confirmingId !== item.id}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, item.id);
          e.dataTransfer.effectAllowed = "move";
          setDraggingId(item.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDropTarget(null);
        }}
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
                onClick={() => setMovingId(movingId === item.id ? null : item.id)}
                aria-label={`Move chat to a folder: ${item.title}`}
                aria-expanded={movingId === item.id}
                title="Move to folder"
              >
                <IconFolder />
              </button>
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
            {movingId === item.id && (
              <ul className="assistant-move-menu" aria-label="Move to folder">
                <li>
                  <button
                    type="button"
                    disabled={!item.folderId}
                    onClick={() => void moveChat(item.id, null)}
                  >
                    No folder
                  </button>
                </li>
                {folders.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      disabled={item.folderId === f.id}
                      onClick={() => void moveChat(item.id, f.id)}
                    >
                      <IconFolder size={11} /> {f.name}
                    </button>
                  </li>
                ))}
                {folders.length === 0 && <li className="muted">No folders yet</li>}
              </ul>
            )}
          </>
        )}
      </li>
    );
  }

  const usageText = formatUsage(chat.usage);
  const hasContent = chat.items.some((i) => i.role !== "error" && i.role !== "summary" && i.text);

  return (
    <Panel
      title="Assistant"
      headerRight={
        <div className="assistant-header-actions">
          {usageText && (
            <span className="muted assistant-usage" title="Tokens and API-equivalent cost for this chat; cached = share of input tokens read from the provider's prompt cache">
              {usageText}
            </span>
          )}
          <Menu
            label="View"
            align="right"
            className="assistant-link"
            items={[
              { key: "history", label: "Chat history", checked: historyOpen, onSelect: () => setHistoryOpen((o) => !o) },
              { key: "memory", label: "Memory", checked: memoryOpen, onSelect: () => setMemoryOpen((o) => !o) },
            ]}
          />
          {hasContent && !chat.busy && (
            <SaveToNotes build={() => chatMarkdown(chat)} label="Save chat" />
          )}
          <Menu
            label={<IconDots size={15} />}
            bare
            align="right"
            className="assistant-link assistant-icon-trigger"
            ariaLabel="More chat options"
            title="More"
            items={[
              {
                key: "compact",
                label: "Summarize older messages",
                disabled: chat.busy || !chat.conversationId,
                onSelect: () => void chat.compact(),
              },
              { key: "settings", label: "Assistant settings…", separatorBefore: true, onSelect: onOpenSettings },
            ]}
          />
          <button
            type="button"
            className="assistant-new-chat"
            onClick={newChat}
            disabled={chat.busy || (chat.items.length === 0 && !chat.conversationId)}
          >
            <IconPlus size={12} /> New chat
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
            {!searching && (
              <div className="assistant-folder-bar">
                {creatingFolder ? (
                  <input
                    className="assistant-chat-rename"
                    value={newFolderName}
                    autoFocus
                    maxLength={60}
                    placeholder="Folder name"
                    aria-label="New folder name"
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onBlur={() => void createFolder()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createFolder();
                      if (e.key === "Escape") {
                        setNewFolderName("");
                        setCreatingFolder(false);
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="assistant-link" onClick={() => setCreatingFolder(true)}>
                    <IconPlus size={11} /> New folder
                  </button>
                )}
              </div>
            )}
            {chats.length === 0 && folders.length === 0 ? (
              <p className="muted">{searching ? "No chats match." : "Past chats appear here."}</p>
            ) : (
              <>
                {!searching &&
                  folders.map((folder) => {
                    const inside = chats.filter((c) => c.folderId === folder.id);
                    const open = !collapsed.has(folder.id);
                    return (
                      <section key={folder.id} className="assistant-folder">
                        <div
                          className={`assistant-folder-head${dropTarget === folder.id ? " drop" : ""}`}
                          {...dropZone(folder.id)}
                        >
                          {renamingFolderId === folder.id ? (
                            <input
                              className="assistant-chat-rename"
                              value={folderValue}
                              autoFocus
                              maxLength={60}
                              aria-label="Folder name"
                              onChange={(e) => setFolderValue(e.target.value)}
                              onBlur={() => void commitFolderRename(folder.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitFolderRename(folder.id);
                                if (e.key === "Escape") setRenamingFolderId(null);
                              }}
                            />
                          ) : confirmingFolderId === folder.id ? (
                            <div className="assistant-chat-confirm">
                              <span>Delete folder? Its chats are kept.</span>
                              <button type="button" onClick={() => void removeFolder(folder.id)}>
                                Delete
                              </button>
                              <button type="button" onClick={() => setConfirmingFolderId(null)}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="assistant-folder-toggle"
                                onClick={() => toggleFolder(folder.id)}
                                aria-expanded={open}
                              >
                                {open ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
                                <IconFolder size={12} />
                                <span className="assistant-folder-name">{folder.name}</span>
                                <span className="assistant-folder-count">{inside.length}</span>
                              </button>
                              <span className="assistant-chat-actions">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFolderValue(folder.name);
                                    setRenamingFolderId(folder.id);
                                  }}
                                  aria-label={`Rename folder: ${folder.name}`}
                                  title="Rename folder"
                                >
                                  <IconPencil />
                                </button>
                                <button
                                  type="button"
                                  className="assistant-chat-delete"
                                  onClick={() => setConfirmingFolderId(folder.id)}
                                  aria-label={`Delete folder: ${folder.name}`}
                                  title="Delete folder"
                                >
                                  <IconTrash />
                                </button>
                              </span>
                            </>
                          )}
                        </div>
                        {open && (
                          <ul className="assistant-chat-list assistant-folder-chats">
                            {inside.length === 0 ? (
                              <li className="muted assistant-folder-empty">Drag chats here</li>
                            ) : (
                              inside.map(renderChat)
                            )}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                <div
                  className={`assistant-root-zone${dropTarget === ROOT ? " drop" : ""}`}
                  {...(searching ? {} : dropZone(null))}
                >
                  {!searching && folders.length > 0 && <div className="assistant-root-label">Chats</div>}
                  <ul className="assistant-chat-list">{topLevel.map(renderChat)}</ul>
                </div>
              </>
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
