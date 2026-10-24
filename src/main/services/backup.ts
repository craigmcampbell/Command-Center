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

// ---- restore ---------------------------------------------------------------
//
// The live database is held open by one long-lived connection that every
// service shares, so it can't be swapped in place. Restore is therefore two
// steps: `stageRestore` validates the chosen file and writes a self-contained
// copy to `restore-pending.db`; the caller then relaunches, and
// `applyPendingRestore` (run in main/index.ts BEFORE initDatabase) moves it over
// the real file. Nothing is touched until the new file has passed validation.

function pendingRestorePath(): string {
  return path.join(app.getPath("userData"), "restore-pending.db");
}

function liveDatabasePath(): string {
  return path.join(app.getPath("userData"), "command-center.db");
}

// A restore is only offered for a file this app wrote itself, which is checked
// by the one table every version of it has: `settings`. An arbitrary SQLite
// file (or a corrupt one) would otherwise replace everything with nothing.
function validateBackup(file: string): string | null {
  let handle: DatabaseType | undefined;
  try {
    handle = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = handle.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") return "That file failed SQLite's integrity check";
    const hasSettings = handle
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
      .get();
    if (!hasSettings) return "That file isn't a Command Center database";
    return null;
  } catch {
    return "That file couldn't be opened as a database";
  } finally {
    handle?.close();
  }
}

// `source` must be a path the caller has already vetted. Returns where the
// pre-restore safety copy of the CURRENT database went, so the UI can say.
export async function stageRestore(
  source: string
): Promise<ActionResult & { safetyCopy?: string }> {
  if (path.resolve(source) === path.resolve(liveDatabasePath())) {
    return { ok: false, reason: "That is the database already in use" };
  }
  const invalid = validateBackup(source);
  if (invalid) return { ok: false, reason: invalid };

  try {
    // Keep what's being replaced. Named outside the `command-center-` pattern
    // so the daily rotation can never prune it.
    fs.mkdirSync(backupsDir(), { recursive: true });
    const safetyCopy = path.join(backupsDir(), `pre-restore-${Date.now()}.db`);
    await getDatabase().backup(safetyCopy);
    consolidate(safetyCopy);

    // Copy through SQLite rather than fs.copyFile, for the same WAL reason as
    // every other copy in this file.
    const pending = pendingRestorePath();
    for (const p of [pending, `${pending}-wal`, `${pending}-shm`]) fs.rmSync(p, { force: true });
    const reader = new Database(source, { readonly: true, fileMustExist: true });
    try {
      await reader.backup(pending);
    } finally {
      reader.close();
    }
    consolidate(pending);
    return { ok: true, safetyCopy };
  } catch (err) {
    fs.rmSync(pendingRestorePath(), { force: true });
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// Boot-time half of a restore. Must run before the database is opened. Never
// throws: if it fails the app starts on the existing database, and the staged
// file is discarded so a stale one can't be applied by some later launch.
export function applyPendingRestore(): void {
  const pending = pendingRestorePath();
  if (!fs.existsSync(pending)) return;
  try {
    const live = liveDatabasePath();
    // The old WAL belongs to the file being replaced; left behind it would be
    // replayed onto the restored database.
    for (const p of [`${live}-wal`, `${live}-shm`]) fs.rmSync(p, { force: true });
    fs.renameSync(pending, live);
  } catch (err) {
    console.error("[backup] couldn't apply the staged restore:", err);
    fs.rmSync(pending, { force: true });
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
