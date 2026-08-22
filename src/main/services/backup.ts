// Backup and export for the one SQLite file that now holds everything: notes
// nav, habits, scratchpad, finances, time entries, tab layout — and every API
// token, in plaintext. Until this existed there was no copy of any of it.
//
// Uses better-sqlite3's `db.backup()` (SQLite's online backup API) rather than
// fs.copyFile, and that distinction matters: services/db.ts opens the database
// in WAL mode, so recent commits can still be sitting in the -wal sidecar file.
// A plain copy of the .db alone would produce a backup that looks perfectly
// valid and silently omits them. The online backup API accounts for the WAL
// and for concurrent writes.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabase } from "./db";
import type { ActionResult, BackupFile } from "../../shared/types";

const DEFAULT_KEEP = 7;
const FILE_PREFIX = "command-center-";

export function backupsDir(): string {
  return path.join(app.getPath("userData"), "backups");
}

function dateStamp(d = new Date()): string {
  // Local date, not toISOString() — that's UTC, and a backup taken at 6pm PST
  // would be filed under tomorrow, breaking the once-a-day check below.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function defaultExportName(): string {
  return `${FILE_PREFIX}backup-${dateStamp()}.db`;
}

export function listBackups(): BackupFile[] {
  const dir = backupsDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // no directory yet — nothing backed up, not an error
  }

  return names
    .filter((n) => n.startsWith(FILE_PREFIX) && n.endsWith(".db"))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { path: full, name, size: stat.size, createdAt: stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

// The backup inherits WAL journal mode from the source, which leaves `-wal`
// and `-shm` sidecars next to the copy. Switching the copy to DELETE mode
// checkpoints the WAL into the main file and removes both, so what's left is
// one self-contained portable file. Without this, an export hands the user
// three files when they'll only think to copy one.
function consolidate(dbPath: string): void {
  let handle: DatabaseType | undefined;
  try {
    handle = new Database(dbPath);
    handle.pragma("wal_checkpoint(TRUNCATE)");
    handle.pragma("journal_mode = DELETE");
  } catch (err) {
    // The copy itself is already valid; failing to tidy it is not fatal.
    console.error("[backup] couldn't consolidate WAL:", err);
  } finally {
    handle?.close();
  }
}

export async function exportDatabase(destPath: string): Promise<ActionResult> {
  try {
    await getDatabase().backup(destPath);
    consolidate(destPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// Keeps the newest `keep` backups. Only ever deletes files matching our own
// naming pattern (listBackups filters on it), so pointing the directory at
// something unexpected can't turn this into a shredder.
function prune(keep: number): void {
  for (const file of listBackups().slice(Math.max(1, keep))) {
    // Sweep the sidecars too. consolidate() normally removes them, but if it
    // ever failed they'd outlive their .db and accumulate as orphans.
    for (const p of [file.path, `${file.path}-wal`, `${file.path}-shm`]) {
      try {
        fs.unlinkSync(p);
      } catch {
        // missing sidecar (the normal case) or an undeletable file — neither
        // is worth failing a backup over
      }
    }
  }
}

// Fire-and-forget at boot. Never throws and never blocks startup — a failed
// backup should be invisible, not a reason the app won't open.
export async function runDailyBackup(enabled: boolean, keep = DEFAULT_KEEP): Promise<void> {
  if (!enabled) return;
  try {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });

    // One backup per calendar day, regardless of how many times the app is
    // launched — the filename itself is the guard, so this stays correct
    // across restarts without tracking state anywhere.
    const dest = path.join(dir, `${FILE_PREFIX}${dateStamp()}.db`);
    if (fs.existsSync(dest)) return;

    await getDatabase().backup(dest);
    consolidate(dest);
    prune(keep);
  } catch (err) {
    console.error("[backup] daily backup failed:", err);
  }
}
