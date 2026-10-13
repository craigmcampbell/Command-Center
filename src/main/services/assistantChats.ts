// Persistence for the Assistant's chat history. One row per chat; the message
// list is a JSON column rather than a row per message because a chat is only
// ever read or replaced whole (resume loads all of it, a new turn rewrites it),
// never queried by message.
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
import type { ChatMessage } from "./assistantTranscript";
import type { AssistantChatSummary, AssistantUsage } from "../../shared/types";

interface ChatRow {
  id: string;
  title: string;
  messages: string;
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

const MAX_SEARCH_TEXT_CHARS = 100_000;

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
  getDatabase()
    .prepare(
      `INSERT INTO assistant_chats
         (id, title, messages, search_text, prompt_tokens, completion_tokens, cost_usd, created_at, updated_at)
       VALUES
         (@id, @title, @messages, @searchText, @promptTokens, @completionTokens, @costUsd, @now, @now)
       ON CONFLICT(id) DO UPDATE SET
         messages = excluded.messages,
         search_text = excluded.search_text,
         prompt_tokens = prompt_tokens + excluded.prompt_tokens,
         completion_tokens = completion_tokens + excluded.completion_tokens,
         cost_usd = CASE
           WHEN excluded.cost_usd IS NULL THEN cost_usd
           ELSE COALESCE(cost_usd, 0) + excluded.cost_usd
         END,
         updated_at = excluded.updated_at`
    )
    .run({
      id,
      title,
      messages: JSON.stringify(messages),
      searchText: searchTextOf(messages),
      promptTokens: turn.promptTokens,
      completionTokens: turn.completionTokens,
      costUsd: turn.costUsd,
      now,
    });
}

export function loadChat(id: string): StoredChat | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, title, messages, pinned, prompt_tokens, completion_tokens, cost_usd, updated_at
         FROM assistant_chats WHERE id = ?`
    )
    .get(id) as ChatRow | undefined;
  if (!row) return null;
  try {
    const messages = JSON.parse(row.messages);
    if (!Array.isArray(messages)) return null;
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
  return getDatabase().prepare(`DELETE FROM assistant_chats WHERE id = ?`).run(id).changes > 0;
}
