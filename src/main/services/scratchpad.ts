// Single-row scratchpad note — autosaved markdown for quick temporary notes.

import { getDatabase } from "./db";

const ROW_ID = 1;

export function initScratchpad(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS scratchpad (
    id INTEGER PRIMARY KEY CHECK (id = ${ROW_ID}),
    content TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )`);
  db.prepare(`INSERT OR IGNORE INTO scratchpad (id, content) VALUES (?, '')`).run(ROW_ID);
}

export function getScratchpad(): string {
  const row = getDatabase()
    .prepare(`SELECT content FROM scratchpad WHERE id = ?`)
    .get(ROW_ID) as { content: string } | undefined;
  return row?.content ?? "";
}

export function saveScratchpad(content: string): void {
  getDatabase()
    .prepare(`UPDATE scratchpad SET content = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
    .run(content, ROW_ID);
}

export function clearScratchpad(): void {
  saveScratchpad("");
}
