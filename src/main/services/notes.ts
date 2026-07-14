// Notes tab: browsing/reading/writing files directly in configured Obsidian
// vaults, plus the left-nav pin list and open-tabs session state (both
// SQLite, via services/links.ts's shared db connection). A note's file on
// disk is the source of truth — the nav/session tables only ever reference
// it by (vaultLabel, filePath), never copy its content.

import fs from "node:fs";
import path from "node:path";
import type {
  ActionResult,
  AppConfig,
  NoteBrowseResult,
  NoteContent,
  NoteCreateResult,
  NoteFileEntry,
  NoteNavItem,
  NotesSession,
  VaultConfig,
  VaultNoteIndexEntry,
  VaultNoteIndexResult,
} from "../../shared/types";
import { getDatabase } from "./links";

const SESSION_ROW_ID = 1;

export function initNotes(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_label TEXT NOT NULL,
    file_path TEXT NOT NULL,
    label TEXT NOT NULL,
    UNIQUE(vault_label, file_path)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS notes_session (
    id INTEGER PRIMARY KEY CHECK (id = ${SESSION_ROW_ID}),
    open_note_ids TEXT NOT NULL DEFAULT '[]',
    active_note_id INTEGER
  )`);
  db.prepare(
    `INSERT OR IGNORE INTO notes_session (id, open_note_ids, active_note_id) VALUES (?, '[]', NULL)`
  ).run(SESSION_ROW_ID);
}

// ---- vault path resolution + safety ----

function findVault(config: AppConfig, vaultLabel: string): VaultConfig | undefined {
  return (config.vaults ?? []).find((v) => v.label === vaultLabel);
}

// Resolves a vault-relative path to an absolute one and rejects anything
// that would land outside the vault root — cheap defense against a stray
// "../" (typed by hand or from a bug) ever reading/writing outside it.
function resolveInVault(
  config: AppConfig,
  vaultLabel: string,
  relativePath: string
): { ok: true; absPath: string } | { ok: false; reason: string } {
  const vault = findVault(config, vaultLabel);
  if (!vault) return { ok: false, reason: `Vault "${vaultLabel}" isn't configured` };

  const root = path.resolve(vault.path);
  const absPath = path.resolve(root, relativePath);
  if (absPath !== root && !absPath.startsWith(root + path.sep)) {
    return { ok: false, reason: "That path is outside the vault" };
  }
  return { ok: true, absPath };
}

// ---- browsing / reading / writing files ----

export function listVaults(config: AppConfig): VaultConfig[] {
  return config.vaults ?? [];
}

export function browseVault(
  config: AppConfig,
  vaultLabel: string,
  subPath = ""
): NoteBrowseResult {
  const resolved = resolveInVault(config, vaultLabel, subPath);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, folders: [], files: [] };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved.absPath, { withFileTypes: true });
  } catch {
    return { ok: false, reason: "Couldn't read that folder", folders: [], files: [] };
  }

  const toEntry = (name: string, isDirectory: boolean): NoteFileEntry => ({
    name,
    path: subPath ? `${subPath}/${name}` : name,
    isDirectory,
  });

  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => toEntry(e.name, true))
    .sort((a, b) => a.name.localeCompare(b.name));

  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => toEntry(e.name, false))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, folders, files };
}

// Recursively indexes every .md file in a vault (basename → relative path),
// for wikilink resolution — browseVault only ever looks at one directory
// level at a time, which isn't enough to resolve a [[Note Name]] that could
// be anywhere in the vault. Same dotfolder exclusion and path-safety
// resolution as browseVault. Sorted by path, so a caller matching by
// basename against duplicate names across folders gets a deterministic
// "first by path" pick rather than whatever order the filesystem returns.
export function buildVaultIndex(config: AppConfig, vaultLabel: string): VaultNoteIndexResult {
  const resolved = resolveInVault(config, vaultLabel, "");
  if (!resolved.ok) return { ok: false, reason: resolved.reason, entries: [] };

  const entries: VaultNoteIndexEntry[] = [];
  function walk(absDir: string, relDir: string) {
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of dirEntries) {
      if (e.name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(path.join(absDir, e.name), rel);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        entries.push({ basename: e.name.slice(0, -3), path: rel });
      }
    }
  }

  try {
    walk(resolved.absPath, "");
  } catch {
    return { ok: false, reason: "Couldn't index that vault", entries: [] };
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, entries };
}

export function readNoteFile(config: AppConfig, vaultLabel: string, filePath: string): NoteContent {
  const resolved = resolveInVault(config, vaultLabel, filePath);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, content: "" };

  try {
    return { ok: true, content: fs.readFileSync(resolved.absPath, "utf8") };
  } catch {
    return { ok: false, reason: "Couldn't read that note", content: "" };
  }
}

export function saveNoteFile(
  config: AppConfig,
  vaultLabel: string,
  filePath: string,
  content: string
): ActionResult {
  const resolved = resolveInVault(config, vaultLabel, filePath);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  try {
    fs.writeFileSync(resolved.absPath, content, "utf8");
    return { ok: true };
  } catch {
    return { ok: false, reason: "Couldn't save that note" };
  }
}

// Creates an empty .md file in a vault folder (picked via the same browser
// used to open existing notes) and hands back its vault-relative path, so
// the caller can pin/open it exactly like an existing file. `name` is a bare
// filename, not a path — rejected if it tries to smuggle in a separator,
// since dirPath is what the folder browser already chose.
export function createNoteFile(
  config: AppConfig,
  vaultLabel: string,
  dirPath: string,
  name: string
): NoteCreateResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: "Name can't be empty", filePath: "" };
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return { ok: false, reason: "Name can't contain a path separator", filePath: "" };
  }

  const fileName = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
  const relPath = dirPath ? `${dirPath}/${fileName}` : fileName;
  const resolved = resolveInVault(config, vaultLabel, relPath);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, filePath: "" };

  if (fs.existsSync(resolved.absPath)) {
    return { ok: false, reason: "A note with that name already exists", filePath: "" };
  }

  try {
    fs.writeFileSync(resolved.absPath, "", "utf8");
    return { ok: true, filePath: relPath };
  } catch {
    return { ok: false, reason: "Couldn't create that note", filePath: "" };
  }
}

// ---- left-nav pin list ----

interface NoteRow {
  id: number;
  vault_label: string;
  file_path: string;
  label: string;
}

function rowToNavItem(row: NoteRow): NoteNavItem {
  return { id: row.id, vaultLabel: row.vault_label, filePath: row.file_path, label: row.label };
}

export function listNavNotes(): NoteNavItem[] {
  return (getDatabase().prepare(`SELECT * FROM notes ORDER BY id ASC`).all() as NoteRow[]).map(
    rowToNavItem
  );
}

export function addNavNote(vaultLabel: string, filePath: string, label: string): NoteNavItem[] {
  getDatabase()
    .prepare(`INSERT OR IGNORE INTO notes (vault_label, file_path, label) VALUES (?, ?, ?)`)
    .run(vaultLabel, filePath, label);
  return listNavNotes();
}

// Removes the nav entry and drops it from the open-tabs session too, so a
// note that's no longer in the nav doesn't linger as an orphaned tab.
export function removeNavNote(id: number): NoteNavItem[] {
  const db = getDatabase();
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);

  const session = getSession();
  const openNoteIds = session.openNoteIds.filter((n) => n !== id);
  const activeNoteId =
    session.activeNoteId === id ? (openNoteIds[openNoteIds.length - 1] ?? null) : session.activeNoteId;
  setSession(openNoteIds, activeNoteId);

  return listNavNotes();
}

// ---- open-tabs session (singleton row, same pattern as services/scratchpad.ts) ----

export function getSession(): NotesSession {
  const row = getDatabase()
    .prepare(`SELECT open_note_ids, active_note_id FROM notes_session WHERE id = ?`)
    .get(SESSION_ROW_ID) as { open_note_ids: string; active_note_id: number | null };
  return { openNoteIds: JSON.parse(row.open_note_ids), activeNoteId: row.active_note_id };
}

export function setSession(openNoteIds: number[], activeNoteId: number | null): NotesSession {
  getDatabase()
    .prepare(`UPDATE notes_session SET open_note_ids = ?, active_note_id = ? WHERE id = ?`)
    .run(JSON.stringify(openNoteIds), activeNoteId, SESSION_ROW_ID);
  return { openNoteIds, activeNoteId };
}
