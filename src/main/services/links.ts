// Persistence for the three quick-launch lists (Local Apps, Learning, Claude
// Code). Each list is its own SQLite table, all with the same shape:
// (id, label, link, sort_order). `link` is a URL for the first two and a
// directory path for Claude Code — the widgets, not this module, decide what
// to do with it.

import { app } from "electron";
import Database from "better-sqlite3";
import path from "node:path";
import type { LinkItem, LinkListKind } from "../../shared/types";

const TABLES: Record<LinkListKind, string> = {
  localApps: "local_apps",
  learning: "learning_links",
  claudeCode: "claude_projects",
};

// Shape of the localApps/learning/claudeCode keys that used to live in
// config.json, before this list moved to SQLite. Only used for the one-time
// seed below — config.json no longer declares these in AppConfig.
export interface LegacyLinkConfig {
  localApps?: { instances?: { label: string; url: string }[] };
  learning?: { instances?: { label: string; url: string }[] };
  claudeCode?: { projects?: { label: string; path: string }[] };
}

let db: Database.Database;

export function getDatabase(): Database.Database {
  return db;
}

export function initDatabase(): void {
  const dbPath = path.join(app.getPath("userData"), "command-center.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  for (const table of Object.values(TABLES)) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      link TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    )`);
  }
}

function seedTable(table: string, entries: { label: string; link: string }[]): void {
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
    count: number;
  };
  if (count > 0 || entries.length === 0) return;

  const insert = db.prepare(`INSERT INTO ${table} (label, link, sort_order) VALUES (?, ?, ?)`);
  const insertAll = db.transaction((rows: { label: string; link: string }[]) => {
    rows.forEach((row, i) => insert.run(row.label, row.link, i));
  });
  insertAll(entries);
}

// One-time migration from the old config.json arrays. Idempotent — each
// table only seeds if it's still empty, so this is safe to call every boot.
export function seedFromLegacyConfig(legacy: LegacyLinkConfig): void {
  seedTable(
    TABLES.localApps,
    (legacy.localApps?.instances ?? []).map((i) => ({ label: i.label, link: i.url }))
  );
  seedTable(
    TABLES.learning,
    (legacy.learning?.instances ?? []).map((i) => ({ label: i.label, link: i.url }))
  );
  seedTable(
    TABLES.claudeCode,
    (legacy.claudeCode?.projects ?? []).map((p) => ({ label: p.label, link: p.path }))
  );
}

function rowsToItems(table: string): LinkItem[] {
  return db
    .prepare(`SELECT id, label, link, sort_order as sortOrder FROM ${table} ORDER BY sort_order ASC`)
    .all() as LinkItem[];
}

export function listLinks(kind: LinkListKind): LinkItem[] {
  return rowsToItems(TABLES[kind]);
}

export function addLink(kind: LinkListKind, label: string, link: string): LinkItem[] {
  const table = TABLES[kind];
  const { maxOrder } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM ${table}`)
    .get() as { maxOrder: number };
  db.prepare(`INSERT INTO ${table} (label, link, sort_order) VALUES (?, ?, ?)`).run(
    label,
    link,
    maxOrder + 1
  );
  return rowsToItems(table);
}

export function updateLink(
  kind: LinkListKind,
  id: number,
  label: string,
  link: string
): LinkItem[] {
  const table = TABLES[kind];
  db.prepare(`UPDATE ${table} SET label = ?, link = ? WHERE id = ?`).run(label, link, id);
  return rowsToItems(table);
}

export function removeLink(kind: LinkListKind, id: number): LinkItem[] {
  const table = TABLES[kind];
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return rowsToItems(table);
}

export function reorderLinks(kind: LinkListKind, orderedIds: number[]): LinkItem[] {
  const table = TABLES[kind];
  const update = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  const updateAll = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => update.run(i, id));
  });
  updateAll(orderedIds);
  return rowsToItems(table);
}
