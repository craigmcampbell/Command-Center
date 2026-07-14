// Shared SQLite connection for every DB-backed service (links, notes, habits,
// scratchpad, settings). One file, one connection, opened once at boot.

import { app } from "electron";
import Database from "better-sqlite3";
import path from "node:path";

let db: Database.Database;

export function getDatabase(): Database.Database {
  return db;
}

export function initDatabase(): void {
  const dbPath = path.join(app.getPath("userData"), "command-center.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
}
