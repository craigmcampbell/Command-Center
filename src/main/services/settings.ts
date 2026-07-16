// Persistence for all app settings that used to live in config.json — one
// place per user, migrated once from that file (or from the bundled
// config.example.json defaults for a fresh install) and never written back
// to it again afterward. Scalar sections (grimoire, docker, app, todoist,
// googleCalendar, reader, github's non-array fields) live as JSON blobs in a
// generic key-value `settings` table — a schema migration is never needed
// when a section gains/loses a field, only the TS type + default. The three
// array sections (vaults, github repos, processes) get their own relational
// tables, each with the same (id, ..., sort_order) CRUD shape as
// services/links.ts.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "./db";
import type {
  AppConfig,
  GrimoireConfig,
  GoogleCalendarConfig,
  GitHubScalarConfig,
  GitHubRepoConfig,
  VaultConfig,
  ProcessConfig,
  YnabScalarConfig,
} from "../../shared/types";

export function initSettings(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS vaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    path TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS github_repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    branch TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS processes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '[]',
    cwd TEXT,
    url TEXT,
    auto_open_url INTEGER,
    open_delay_ms INTEGER,
    sort_order INTEGER NOT NULL
  )`);
}

// ---- generic scalar helpers (settings table) ----

function getRaw<T>(key: string): T | undefined {
  const row = getDatabase().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

function setRaw<T>(key: string, value: T): void {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, JSON.stringify(value));
}

function seedRawIfEmpty(key: string, value: unknown): void {
  const existing = getDatabase().prepare(`SELECT 1 FROM settings WHERE key = ?`).get(key);
  if (!existing) setRaw(key, value);
}

// ---- scalar sections ----

export function getGrimoireSettings(): GrimoireConfig {
  return getRaw<GrimoireConfig>("grimoire") ?? { vaultPath: "", dailyLogDir: "", missionsDir: "" };
}
export function updateGrimoireSettings(values: GrimoireConfig): GrimoireConfig {
  setRaw("grimoire", values);
  return values;
}

export function getDockerSettings(): { refreshSeconds: number } {
  return getRaw("docker") ?? { refreshSeconds: 15 };
}
export function updateDockerSettings(values: {
  refreshSeconds: number;
}): { refreshSeconds: number } {
  setRaw("docker", values);
  return values;
}

export function getAppSettings(): { refreshMinutes?: number } {
  return getRaw("app") ?? {};
}
export function updateAppSettings(values: {
  refreshMinutes?: number;
}): { refreshMinutes?: number } {
  setRaw("app", values);
  return values;
}

export function getTodoistSettings(): { apiToken: string } {
  return getRaw("todoist") ?? { apiToken: "" };
}
export function updateTodoistSettings(values: { apiToken: string }): { apiToken: string } {
  setRaw("todoist", values);
  return values;
}

export function getGoogleCalendarSettings(): GoogleCalendarConfig {
  return getRaw<GoogleCalendarConfig>("googleCalendar") ?? { clientId: "", clientSecret: "" };
}
export function updateGoogleCalendarSettings(values: GoogleCalendarConfig): GoogleCalendarConfig {
  setRaw("googleCalendar", values);
  return values;
}

export function getReaderSettings(): { apiToken: string } {
  return getRaw("reader") ?? { apiToken: "" };
}
export function updateReaderSettings(values: { apiToken: string }): { apiToken: string } {
  setRaw("reader", values);
  return values;
}

export function getGithubScalarSettings(): GitHubScalarConfig {
  return getRaw<GitHubScalarConfig>("github") ?? {};
}
export function updateGithubScalarSettings(values: GitHubScalarConfig): GitHubScalarConfig {
  setRaw("github", values);
  return values;
}

export function getYnabSettings(): YnabScalarConfig {
  return getRaw<YnabScalarConfig>("ynab") ?? { hiddenAccountIds: [] };
}
export function updateYnabSettings(values: YnabScalarConfig): YnabScalarConfig {
  setRaw("ynab", values);
  return values;
}
export function toggleYnabAccountHidden(accountId: string): YnabScalarConfig {
  const current = getYnabSettings();
  const hidden = new Set(current.hiddenAccountIds ?? []);
  if (hidden.has(accountId)) {
    hidden.delete(accountId);
  } else {
    hidden.add(accountId);
  }
  return updateYnabSettings({ ...current, hiddenAccountIds: [...hidden] });
}

// ---- vaults ----

function vaultRowsToItems(): VaultConfig[] {
  return getDatabase()
    .prepare(`SELECT id, label, path, sort_order as sortOrder FROM vaults ORDER BY sort_order ASC`)
    .all() as VaultConfig[];
}

export function listVaultSettings(): VaultConfig[] {
  return vaultRowsToItems();
}

export function addVault(label: string, vaultPath: string): VaultConfig[] {
  const db = getDatabase();
  const { maxOrder } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM vaults`)
    .get() as { maxOrder: number };
  db.prepare(`INSERT INTO vaults (label, path, sort_order) VALUES (?, ?, ?)`).run(
    label,
    vaultPath,
    maxOrder + 1
  );
  return vaultRowsToItems();
}

export function updateVault(id: number, label: string, vaultPath: string): VaultConfig[] {
  getDatabase()
    .prepare(`UPDATE vaults SET label = ?, path = ? WHERE id = ?`)
    .run(label, vaultPath, id);
  return vaultRowsToItems();
}

export function removeVault(id: number): VaultConfig[] {
  getDatabase().prepare(`DELETE FROM vaults WHERE id = ?`).run(id);
  return vaultRowsToItems();
}

export function reorderVaults(orderedIds: number[]): VaultConfig[] {
  const db = getDatabase();
  const update = db.prepare(`UPDATE vaults SET sort_order = ? WHERE id = ?`);
  const updateAll = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => update.run(i, id));
  });
  updateAll(orderedIds);
  return vaultRowsToItems();
}

// ---- github repos ----

function githubRepoRowsToItems(): GitHubRepoConfig[] {
  return getDatabase()
    .prepare(
      `SELECT id, label, owner, repo, branch, sort_order as sortOrder FROM github_repos ORDER BY sort_order ASC`
    )
    .all() as GitHubRepoConfig[];
}

export function listGithubRepoSettings(): GitHubRepoConfig[] {
  return githubRepoRowsToItems();
}

export function addGithubRepo(
  label: string,
  owner: string,
  repo: string,
  branch: string
): GitHubRepoConfig[] {
  const db = getDatabase();
  const { maxOrder } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM github_repos`)
    .get() as { maxOrder: number };
  db.prepare(
    `INSERT INTO github_repos (label, owner, repo, branch, sort_order) VALUES (?, ?, ?, ?, ?)`
  ).run(label, owner, repo, branch, maxOrder + 1);
  return githubRepoRowsToItems();
}

export function updateGithubRepo(
  id: number,
  label: string,
  owner: string,
  repo: string,
  branch: string
): GitHubRepoConfig[] {
  getDatabase()
    .prepare(`UPDATE github_repos SET label = ?, owner = ?, repo = ?, branch = ? WHERE id = ?`)
    .run(label, owner, repo, branch, id);
  return githubRepoRowsToItems();
}

export function removeGithubRepo(id: number): GitHubRepoConfig[] {
  getDatabase().prepare(`DELETE FROM github_repos WHERE id = ?`).run(id);
  return githubRepoRowsToItems();
}

export function reorderGithubRepos(orderedIds: number[]): GitHubRepoConfig[] {
  const db = getDatabase();
  const update = db.prepare(`UPDATE github_repos SET sort_order = ? WHERE id = ?`);
  const updateAll = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => update.run(i, id));
  });
  updateAll(orderedIds);
  return githubRepoRowsToItems();
}

// ---- processes ----

interface ProcessRow {
  id: string;
  label: string;
  command: string;
  args: string;
  cwd: string | null;
  url: string | null;
  auto_open_url: number | null;
  open_delay_ms: number | null;
  sortOrder: number;
}

function processRowToConfig(row: ProcessRow): ProcessConfig {
  return {
    id: row.id,
    label: row.label,
    command: row.command,
    args: JSON.parse(row.args),
    cwd: row.cwd ?? undefined,
    url: row.url ?? undefined,
    autoOpenUrl: row.auto_open_url == null ? undefined : Boolean(row.auto_open_url),
    openDelayMs: row.open_delay_ms ?? undefined,
    sortOrder: row.sortOrder,
  };
}

function processRowsToItems(): ProcessConfig[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, label, command, args, cwd, url, auto_open_url, open_delay_ms, sort_order as sortOrder
       FROM processes ORDER BY sort_order ASC`
    )
    .all() as ProcessRow[];
  return rows.map(processRowToConfig);
}

export function listProcessSettings(): ProcessConfig[] {
  return processRowsToItems();
}

export function addProcess(proc: Omit<ProcessConfig, "sortOrder">): ProcessConfig[] {
  const db = getDatabase();
  const { maxOrder } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM processes`)
    .get() as { maxOrder: number };
  db.prepare(
    `INSERT INTO processes (id, label, command, args, cwd, url, auto_open_url, open_delay_ms, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    proc.id,
    proc.label,
    proc.command,
    JSON.stringify(proc.args ?? []),
    proc.cwd ?? null,
    proc.url ?? null,
    proc.autoOpenUrl == null ? null : proc.autoOpenUrl ? 1 : 0,
    proc.openDelayMs ?? null,
    maxOrder + 1
  );
  return processRowsToItems();
}

export function updateProcess(
  id: string,
  proc: Omit<ProcessConfig, "id" | "sortOrder">
): ProcessConfig[] {
  getDatabase()
    .prepare(
      `UPDATE processes SET label = ?, command = ?, args = ?, cwd = ?, url = ?, auto_open_url = ?, open_delay_ms = ?
       WHERE id = ?`
    )
    .run(
      proc.label,
      proc.command,
      JSON.stringify(proc.args ?? []),
      proc.cwd ?? null,
      proc.url ?? null,
      proc.autoOpenUrl == null ? null : proc.autoOpenUrl ? 1 : 0,
      proc.openDelayMs ?? null,
      id
    );
  return processRowsToItems();
}

export function removeProcess(id: string): ProcessConfig[] {
  getDatabase().prepare(`DELETE FROM processes WHERE id = ?`).run(id);
  return processRowsToItems();
}

export function reorderProcesses(orderedIds: string[]): ProcessConfig[] {
  const db = getDatabase();
  const update = db.prepare(`UPDATE processes SET sort_order = ? WHERE id = ?`);
  const updateAll = db.transaction((ids: string[]) => {
    ids.forEach((id, i) => update.run(i, id));
  });
  updateAll(orderedIds);
  return processRowsToItems();
}

// ---- assembled view ----

export function getAllSettings(): AppConfig {
  const githubScalar = getGithubScalarSettings();
  const repos = listGithubRepoSettings();
  return {
    grimoire: getGrimoireSettings(),
    docker: getDockerSettings(),
    app: getAppSettings(),
    todoist: getTodoistSettings(),
    googleCalendar: getGoogleCalendarSettings(),
    reader: getReaderSettings(),
    github: { ...githubScalar, repos },
    vaults: listVaultSettings(),
    processes: listProcessSettings(),
    ynab: getYnabSettings(),
  };
}

// ---- legacy config.json migration ----
// Reads config.json exactly once at boot to seed the DB (dev: repo root,
// same path convention as the pre-migration loadConfig(); packaged: the
// per-app userData copy an older version of this app may have created).
// Read-only — this app never writes to config.json again, and a fresh
// packaged install with no existing config.json gets no file created for it
// at all.

// NOTE: electron-vite's SSR build bundles every main-process source file
// (index.ts, every services/*.ts) into a single out/main/index.js, so
// __dirname here at runtime is out/main — same depth as index.ts's own
// __dirname — regardless of this file's location in src/. Don't add extra
// ".." levels to account for this file living in services/; there's no
// corresponding nesting in the compiled output.
export function readLegacyConfigFile(): Record<string, unknown> | null {
  const configPath = !app.isPackaged
    ? path.join(__dirname, "..", "..", "config.json")
    : path.join(app.getPath("userData"), "config.json");
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function readDefaultsFile(): Record<string, unknown> {
  const defaultsPath = !app.isPackaged
    ? path.join(__dirname, "..", "..", "config.example.json")
    : path.join(process.resourcesPath, "config.example.json");
  return JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
}

// One-time migration from config.json (or, for a fresh install with no
// config.json at all, the bundled config.example.json defaults) into the DB.
// Idempotent per-section — safe to call every boot.
export function seedSettingsFromLegacyConfig(legacy: Record<string, unknown> | null): void {
  const defaults = readDefaultsFile();
  const pick = <T>(key: string): T | undefined =>
    (legacy?.[key] as T | undefined) ?? (defaults[key] as T | undefined);

  seedRawIfEmpty("grimoire", pick("grimoire") ?? { vaultPath: "", dailyLogDir: "", missionsDir: "" });
  seedRawIfEmpty("docker", pick("docker") ?? { refreshSeconds: 15 });
  seedRawIfEmpty("app", pick("app") ?? {});
  seedRawIfEmpty("todoist", pick("todoist") ?? { apiToken: "" });
  seedRawIfEmpty("googleCalendar", pick("googleCalendar") ?? { clientId: "", clientSecret: "" });
  seedRawIfEmpty("reader", pick("reader") ?? { apiToken: "" });

  const legacyGithub = (legacy?.github ?? defaults.github ?? {}) as {
    token?: string;
    refreshSeconds?: number;
    reviewUser?: string;
    repos?: { label: string; owner: string; repo: string; branch: string }[];
  };
  seedRawIfEmpty("github", {
    token: legacyGithub.token,
    refreshSeconds: legacyGithub.refreshSeconds,
    reviewUser: legacyGithub.reviewUser,
  });

  seedRawIfEmpty("ynab", pick("ynab") ?? { hiddenAccountIds: [] });

  seedVaultsIfEmpty(pick<{ label: string; path: string }[]>("vaults") ?? []);
  seedGithubReposIfEmpty(legacyGithub.repos ?? []);
  seedProcessesIfEmpty(pick<Omit<ProcessConfig, "sortOrder">[]>("processes") ?? []);
}

function seedVaultsIfEmpty(entries: { label: string; path: string }[]): void {
  const db = getDatabase();
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM vaults`).get() as { count: number };
  if (count > 0 || entries.length === 0) return;
  const insert = db.prepare(`INSERT INTO vaults (label, path, sort_order) VALUES (?, ?, ?)`);
  const insertAll = db.transaction((rows: { label: string; path: string }[]) => {
    rows.forEach((row, i) => insert.run(row.label, row.path, i));
  });
  insertAll(entries);
}

function seedGithubReposIfEmpty(
  entries: { label: string; owner: string; repo: string; branch: string }[]
): void {
  const db = getDatabase();
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM github_repos`).get() as {
    count: number;
  };
  if (count > 0 || entries.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO github_repos (label, owner, repo, branch, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction(
    (rows: { label: string; owner: string; repo: string; branch: string }[]) => {
      rows.forEach((row, i) => insert.run(row.label, row.owner, row.repo, row.branch, i));
    }
  );
  insertAll(entries);
}

function seedProcessesIfEmpty(entries: Omit<ProcessConfig, "sortOrder">[]): void {
  const db = getDatabase();
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM processes`).get() as {
    count: number;
  };
  if (count > 0 || entries.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO processes (id, label, command, args, cwd, url, auto_open_url, open_delay_ms, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction((rows: Omit<ProcessConfig, "sortOrder">[]) => {
    rows.forEach((row, i) =>
      insert.run(
        row.id,
        row.label,
        row.command,
        JSON.stringify(row.args ?? []),
        row.cwd ?? null,
        row.url ?? null,
        row.autoOpenUrl == null ? null : row.autoOpenUrl ? 1 : 0,
        row.openDelayMs ?? null,
        i
      )
    );
  });
  insertAll(entries);
}
