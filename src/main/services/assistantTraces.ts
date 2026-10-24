// Per-turn traces for the Assistant: what each model request and tool call in
// a turn cost and how long it took, for the "Turn details" view. One row per
// turn, keyed by chat id + a per-chat turn number; the steps are a JSON column
// because a trace is only ever written or read whole, like a chat's messages.
//
// Sizes and metadata only. A trace never holds prompt text, replies, tool
// arguments or tool results — those are already in `assistant_messages`, and a
// second copy here would outlive a compaction or an edit to the real thing.
//
// Traces are diagnostics: every caller wraps these in try/catch, and nothing
// in services/assistant.ts waits on them or fails because of them. Failed turns
// are recorded too (that is most of the point), so a chat whose first turn
// failed can have traces and no chat row; boot clears those out after a day.

import { getDatabase } from "./db";
import type { AssistantTurnTrace } from "../../shared/types";

// Per chat. Older turns are dropped as new ones are written.
export const MAX_TRACES_PER_CHAT = 50;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export function initAssistantTraces(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_traces (
    chat_id TEXT NOT NULL,
    turn_seq INTEGER NOT NULL,
    user_index INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (chat_id, turn_seq)
  ) WITHOUT ROWID`);
  // Traces of chats that were never saved (every attempt failed) or were
  // deleted while a title request was still writing to its trace.
  db.prepare(
    `DELETE FROM assistant_traces
      WHERE started_at < ?
        AND NOT EXISTS (SELECT 1 FROM assistant_chats c WHERE c.id = assistant_traces.chat_id)`
  ).run(Date.now() - ORPHAN_AGE_MS);
}

// Writes a turn's trace and returns its turn number. A trace with no number yet
// gets the next one for its chat; one that already has one is replaced (the
// title request finishing after the reply adds its step this way).
export function saveTrace(chatId: string, trace: AssistantTurnTrace): number {
  const db = getDatabase();
  return db.transaction(() => {
    const seq =
      trace.turnSeq > 0
        ? trace.turnSeq
        : (
            db
              .prepare(`SELECT COALESCE(MAX(turn_seq), 0) + 1 AS n FROM assistant_traces WHERE chat_id = ?`)
              .get(chatId) as { n: number }
          ).n;
    db.prepare(
      `INSERT OR REPLACE INTO assistant_traces (chat_id, turn_seq, user_index, started_at, outcome, data)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(chatId, seq, trace.userIndex, trace.startedAt, trace.outcome, JSON.stringify({ ...trace, turnSeq: seq }));
    db.prepare(`DELETE FROM assistant_traces WHERE chat_id = ? AND turn_seq <= ?`).run(
      chatId,
      seq - MAX_TRACES_PER_CHAT
    );
    return seq;
  })();
}

// Oldest first. A row that doesn't parse is skipped rather than failing the list.
export function listTraces(chatId: string): AssistantTurnTrace[] {
  const rows = getDatabase()
    .prepare(`SELECT data FROM assistant_traces WHERE chat_id = ? ORDER BY turn_seq`)
    .all(chatId) as { data: string }[];
  const traces: AssistantTurnTrace[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.data);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.steps)) traces.push(parsed);
    } catch {
      // Unreadable diagnostics are just missing diagnostics.
    }
  }
  return traces;
}

export function deleteTraces(chatId: string): void {
  getDatabase().prepare(`DELETE FROM assistant_traces WHERE chat_id = ?`).run(chatId);
}
