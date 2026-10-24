// Persistence for the Assistant's chat history. `assistant_chats` holds one row
// of metadata per chat (title, pin, usage); `assistant_messages` holds one row
// per message, in order. Rows rather than a JSON blob because compaction flags
// individual messages (`archived`, `summary`) and later features hang data off
// single messages. A chat is still only ever read or replaced whole, so a save
// rewrites its rows in one transaction.
//
// The old `assistant_chats.messages` JSON column is kept, not dropped: boot
// copies each chat that has no message rows yet into the new table and leaves
// the original as an untouched backup. New chats write `'[]'` there.
//
// The system prompt is deliberately NOT stored: it embeds today's date and a
// snapshot of the memory file, both stale by the time a chat is resumed, so
// services/assistant.ts rebuilds it fresh on load.
//
// Search can't run over the JSON column — it is full of tool payloads and
// call arguments, so "tasks" would match nearly every chat that ever looked
// something up. `search_text` holds just what was SAID (user and assistant
// text), maintained on every save.

import { getDatabase } from "./db";
import type { ChatMessage, ToolCall } from "./assistantTranscript";
import type { AssistantChatSummary, AssistantUsage } from "../../shared/types";

interface ChatRow {
  id: string;
  title: string;
  pinned: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number | null;
  updated_at: number;
}

export interface StoredChat {
  id: string;
  title: string;
  pinned: boolean;
  messages: ChatMessage[];
  usage: AssistantUsage;
}

interface MessageRow {
  role: ChatMessage["role"];
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  archived: number;
  summary: number;
}

const MAX_SEARCH_TEXT_CHARS = 100_000;

function toRow(m: ChatMessage): MessageRow {
  return {
    role: m.role,
    content: m.content,
    tool_calls: m.role === "assistant" && m.tool_calls ? JSON.stringify(m.tool_calls) : null,
    tool_call_id: m.role === "tool" ? m.tool_call_id : null,
    archived: m.archived ? 1 : 0,
    summary: m.role === "system" && m.summary ? 1 : 0,
  };
}

// Throws on a malformed `tool_calls` payload; loadChat turns that into "no such
// chat" rather than a half-readable one.
function fromRow(row: MessageRow): ChatMessage {
  const archived = row.archived === 1 ? { archived: true as const } : {};
  switch (row.role) {
    case "tool":
      return { role: "tool", tool_call_id: row.tool_call_id ?? "", content: row.content ?? "", ...archived };
    case "assistant": {
      const calls: ToolCall[] | null = row.tool_calls ? JSON.parse(row.tool_calls) : null;
      if (calls !== null && !Array.isArray(calls)) throw new Error("tool_calls is not a list");
      return { role: "assistant", content: row.content, ...(calls ? { tool_calls: calls } : {}), ...archived };
    }
    case "system":
      return { role: "system", content: row.content ?? "", ...(row.summary === 1 ? { summary: true } : {}), ...archived };
    default:
      return { role: "user", content: row.content ?? "", ...archived };
  }
}

// Replaces a chat's messages. Callers wrap it in a transaction.
function writeMessages(chatId: string, messages: ChatMessage[]): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM assistant_messages WHERE chat_id = ?`).run(chatId);
  const insert = db.prepare(
    `INSERT INTO assistant_messages (chat_id, seq, role, content, tool_calls, tool_call_id, archived, summary)
     VALUES (@chatId, @seq, @role, @content, @tool_calls, @tool_call_id, @archived, @summary)`
  );
  messages.forEach((m, seq) => insert.run({ chatId, seq, ...toRow(m) }));
}

// Only what a person would remember being said — never tool payloads.
export function searchTextOf(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if ((m.role === "user" || m.role === "assistant") && m.content) parts.push(m.content);
  }
  return parts.join("\n").slice(0, MAX_SEARCH_TEXT_CHARS);
}

// LIKE treats % and _ as wildcards; a user searching "100%" or "snake_case"
// means the literal characters.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const db = getDatabase();
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (existing.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function initAssistantChats(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    messages TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  // Additive migrations, run every boot: a column added later has to reach
  // databases that already have the table.
  addColumnIfMissing("assistant_chats", "pinned", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("assistant_chats", "search_text", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("assistant_chats", "prompt_tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("assistant_chats", "completion_tokens", "INTEGER NOT NULL DEFAULT 0");
  // NULL, not 0, means "the provider never reported a cost" — the two must not
  // be confused or a free-looking $0.00 would hide real spend.
  addColumnIfMissing("assistant_chats", "cost_usd", "REAL");
  db.exec(`CREATE INDEX IF NOT EXISTS assistant_chats_updated ON assistant_chats (updated_at DESC)`);
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_messages (
    chat_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_calls TEXT,
    tool_call_id TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    summary INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, seq)
  ) WITHOUT ROWID`);

  // One-time, idempotent: a chat with no message rows yet is copied over from
  // its JSON column. A chat that has rows is never touched again, so this is
  // safe on every boot.
  const unmigrated = db
    .prepare(
      `SELECT id, messages FROM assistant_chats
        WHERE messages != '[]'
          AND NOT EXISTS (SELECT 1 FROM assistant_messages m WHERE m.chat_id = assistant_chats.id)`
    )
    .all() as { id: string; messages: string }[];
  const migrate = db.transaction((id: string, messages: ChatMessage[]) => writeMessages(id, messages));
  for (const row of unmigrated) {
    try {
      const parsed = JSON.parse(row.messages);
      if (Array.isArray(parsed) && parsed.length > 0) migrate(row.id, parsed);
    } catch {
      // A corrupt legacy row stays unreadable, exactly as before.
    }
  }

  // Backfill search text for chats saved before it existed.
  const stale = db
    .prepare(`SELECT id, messages FROM assistant_chats WHERE search_text = ''`)
    .all() as { id: string; messages: string }[];
  const update = db.prepare(`UPDATE assistant_chats SET search_text = ? WHERE id = ?`);
  for (const row of stale) {
    try {
      update.run(searchTextOf(JSON.parse(row.messages)), row.id);
    } catch {
      // A corrupt row simply stays unsearchable.
    }
  }
}

// Insert-or-replace. Deliberately leaves `title` and `pinned` alone on update:
// those are the user's to change (rename/pin), and a later reply in the chat
// must not undo them. `usage` is the cost of THIS turn and is added to the
// running totals.
export function saveChat(
  id: string,
  title: string,
  messages: ChatMessage[],
  usage?: AssistantUsage
): void {
  const now = Date.now();
  const turn = usage ?? { promptTokens: 0, completionTokens: 0, costUsd: null };
  const db = getDatabase();
  const upsert = db
    .prepare(
      `INSERT INTO assistant_chats
         (id, title, messages, search_text, prompt_tokens, completion_tokens, cost_usd, created_at, updated_at)
       VALUES
         (@id, @title, '[]', @searchText, @promptTokens, @completionTokens, @costUsd, @now, @now)
       ON CONFLICT(id) DO UPDATE SET
         search_text = excluded.search_text,
         prompt_tokens = prompt_tokens + excluded.prompt_tokens,
         completion_tokens = completion_tokens + excluded.completion_tokens,
         cost_usd = CASE
           WHEN excluded.cost_usd IS NULL THEN cost_usd
           ELSE COALESCE(cost_usd, 0) + excluded.cost_usd
         END,
         updated_at = excluded.updated_at`
    );
  db.transaction(() => {
    upsert.run({
      id,
      title,
      searchText: searchTextOf(messages),
      promptTokens: turn.promptTokens,
      completionTokens: turn.completionTokens,
      costUsd: turn.costUsd,
      now,
    });
    writeMessages(id, messages);
  })();
}

export function loadChat(id: string): StoredChat | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, title, pinned, prompt_tokens, completion_tokens, cost_usd, updated_at
         FROM assistant_chats WHERE id = ?`
    )
    .get(id) as ChatRow | undefined;
  if (!row) return null;
  try {
    const rows = getDatabase()
      .prepare(
        `SELECT role, content, tool_calls, tool_call_id, archived, summary
           FROM assistant_messages WHERE chat_id = ? ORDER BY seq`
      )
      .all(id) as MessageRow[];
    // A saved chat always has at least its opening question.
    if (rows.length === 0) return null;
    const messages = rows.map(fromRow);
    return {
      id: row.id,
      title: row.title,
      pinned: row.pinned === 1,
      messages,
      usage: {
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        costUsd: row.cost_usd,
      },
    };
  } catch {
    // A corrupt row reads as "no such chat" instead of breaking the history list.
    return null;
  }
}

// Pinned chats first, then newest. With a query, every whitespace-separated
// term must appear in the title or in what was said (AND across terms), so
// "sprint docker" narrows rather than widens.
export function listChats(query?: string): AssistantChatSummary[] {
  const terms = (query ?? "").split(/\s+/).filter(Boolean).slice(0, 8);
  const where = terms
    .map(() => `(title LIKE ? ESCAPE '\\' OR search_text LIKE ? ESCAPE '\\')`)
    .join(" AND ");
  const params = terms.flatMap((t) => {
    const like = `%${escapeLike(t)}%`;
    return [like, like];
  });
  const rows = getDatabase()
    .prepare(
      `SELECT id, title, pinned, updated_at FROM assistant_chats
        ${where ? `WHERE ${where}` : ""}
        ORDER BY pinned DESC, updated_at DESC LIMIT 200`
    )
    .all(...params) as Pick<ChatRow, "id" | "title" | "pinned" | "updated_at">[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pinned: r.pinned === 1,
    updatedAt: r.updated_at,
  }));
}

export function renameChat(id: string, title: string): boolean {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) return false;
  return (
    getDatabase().prepare(`UPDATE assistant_chats SET title = ? WHERE id = ?`).run(clean, id)
      .changes > 0
  );
}

// Sets the title only if it is still `expected`. The check and the write are one
// SQL statement, so an AI-written title can never overwrite a rename the user
// made while the title request was in flight — there is no read-then-write gap.
export function renameChatIfUnchanged(id: string, expected: string, title: string): boolean {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) return false;
  return (
    getDatabase()
      .prepare(`UPDATE assistant_chats SET title = ? WHERE id = ? AND title = ?`)
      .run(clean, id, expected).changes > 0
  );
}

// Adds spend that happened outside a normal reply (the title request) to the
// chat's running totals, without touching its messages or its position in the
// history list. A chat deleted in the meantime is simply not found.
export function addChatUsage(id: string, usage: AssistantUsage): boolean {
  return (
    getDatabase()
      .prepare(
        `UPDATE assistant_chats SET
           prompt_tokens = prompt_tokens + @promptTokens,
           completion_tokens = completion_tokens + @completionTokens,
           cost_usd = CASE
             WHEN @costUsd IS NULL THEN cost_usd
             ELSE COALESCE(cost_usd, 0) + @costUsd
           END
         WHERE id = @id`
      )
      .run({ id, ...usage }).changes > 0
  );
}

export function setChatPinned(id: string, pinned: boolean): boolean {
  return (
    getDatabase()
      .prepare(`UPDATE assistant_chats SET pinned = ? WHERE id = ?`)
      .run(pinned ? 1 : 0, id).changes > 0
  );
}

export function deleteChat(id: string): boolean {
  const db = getDatabase();
  return db.transaction(() => {
    db.prepare(`DELETE FROM assistant_messages WHERE chat_id = ?`).run(id);
    return db.prepare(`DELETE FROM assistant_chats WHERE id = ?`).run(id).changes > 0;
  })();
}
