// Local Codex subscription telemetry. Codex writes token counters, rolling
// rate-limit snapshots, and session metadata under CODEX_HOME (normally
// ~/.codex), so this needs no API or Admin key and never sends data anywhere.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import Database from "better-sqlite3";
import type {
  CodexQuotaSnapshot,
  CodexQuotaWindow,
  CodexSession,
  CodexSessionsResult,
  CodexTokenTotals,
  CodexUsageBucket,
  CodexUsageResult,
  CodexUsageWindow,
} from "../../shared/types";

interface UsageEntry {
  dedupeKey: string;
  date: string;
  timestampMs: number;
  cwd: string;
  model: string;
  tokens: CodexTokenTotals;
}

interface SessionMeta {
  id: string;
  cwd: string;
  model?: string;
  updatedAt: number;
}

interface ParsedFile {
  entries: UsageEntry[];
  quotas: CodexQuotaSnapshot[];
  session?: SessionMeta;
}

interface CacheSlot extends ParsedFile {
  size: number;
  mtimeMs: number;
}

interface ScanResult {
  files: ParsedFile[];
  scanMs: number;
}

interface ThreadRow {
  id: string;
  cwd: string;
  title: string;
  name: string | null;
  first_user_message: string;
  model: string | null;
  reasoning_effort: string | null;
  tokens_used: number;
  updated_at_ms: number;
}

const cache = new Map<string, CacheSlot>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function codexHome(override?: string): string {
  return override ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

function emptyTokens(): CodexTokenTotals {
  return { input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0 };
}

function addTokens(into: CodexTokenTotals, from: CodexTokenTotals): void {
  into.input += from.input;
  into.cachedInput += from.cachedInput;
  into.cacheWriteInput += from.cacheWriteInput;
  into.output += from.output;
  into.reasoningOutput += from.reasoningOutput;
}

function totalTokens(tokens: CodexTokenTotals): number {
  return tokens.input + tokens.output;
}

function emptyWindow(): CodexUsageWindow {
  return { requests: 0, tokens: emptyTokens() };
}

function localDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(nowMs: number, count: number): string {
  const date = new Date(nowMs);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - count);
  return localDate(date.getTime());
}

function projectLabel(cwd: string): string {
  return cwd ? path.basename(cwd) : "unknown";
}

function findJsonl(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findJsonl(full, out);
    else if (entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseQuotaWindow(
  value: unknown,
  reportedAt: number,
  nowMs: number
): CodexQuotaWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const windowMinutes = numberValue(raw.window_minutes);
  const usedPercent = numberValue(raw.used_percent);
  let resetsAt = numberValue(raw.resets_at) * 1000;
  if (!resetsAt && typeof raw.resets_in_seconds === "number") {
    resetsAt = reportedAt + raw.resets_in_seconds * 1000;
  }
  if (!windowMinutes || !resetsAt) return undefined;
  return { usedPercent, windowMinutes, resetsAt, stale: resetsAt <= nowMs };
}

function parseQuota(value: unknown, reportedAt: number, nowMs: number): CodexQuotaSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const creditsRaw = raw.credits as Record<string, unknown> | undefined;
  const quota: CodexQuotaSnapshot = {
    reportedAt,
    planType: typeof raw.plan_type === "string" ? raw.plan_type : undefined,
    primary: parseQuotaWindow(raw.primary, reportedAt, nowMs),
    secondary: parseQuotaWindow(raw.secondary, reportedAt, nowMs),
    rateLimitReachedType:
      typeof raw.rate_limit_reached_type === "string" ? raw.rate_limit_reached_type : undefined,
    spendControlReached:
      typeof raw.spend_control_reached === "boolean" ? raw.spend_control_reached : undefined,
  };
  if (creditsRaw) {
    quota.credits = {
      hasCredits: creditsRaw.has_credits === true,
      unlimited: creditsRaw.unlimited === true,
      balance:
        typeof creditsRaw.balance === "string" || typeof creditsRaw.balance === "number"
          ? String(creditsRaw.balance)
          : undefined,
    };
  }
  return quota.primary || quota.secondary || quota.planType || quota.credits ? quota : undefined;
}

async function parseFile(file: string, nowMs: number): Promise<ParsedFile> {
  const entries: UsageEntry[] = [];
  const quotas: CodexQuotaSnapshot[] = [];
  let session: SessionMeta | undefined;
  let cwd = "";
  let model = "unknown";

  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (
      !line.includes('"token_count"') &&
      !line.includes('"session_meta"') &&
      !line.includes('"turn_context"')
    ) {
      continue;
    }

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    if (record.type === "session_meta") {
      cwd = typeof payload.cwd === "string" ? payload.cwd : cwd;
      const id =
        typeof payload.session_id === "string"
          ? payload.session_id
          : typeof payload.id === "string"
            ? payload.id
            : "";
      if (id) session = { id, cwd, model: undefined, updatedAt: 0 };
      continue;
    }
    if (record.type === "turn_context") {
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.model === "string") model = payload.model;
      if (session) {
        session.cwd = cwd || session.cwd;
        session.model = model === "unknown" ? session.model : model;
      }
      continue;
    }
    if (record.type !== "event_msg" || payload.type !== "token_count") continue;

    const timestampMs = Date.parse(typeof record.timestamp === "string" ? record.timestamp : "");
    if (!Number.isFinite(timestampMs)) continue;
    const quota = parseQuota(payload.rate_limits, timestampMs, nowMs);
    if (quota) quotas.push(quota);

    const info = payload.info as Record<string, unknown> | undefined;
    const raw = info?.last_token_usage as Record<string, unknown> | undefined;
    if (!raw) continue;
    const tokens: CodexTokenTotals = {
      input: numberValue(raw.input_tokens),
      cachedInput: numberValue(raw.cached_input_tokens),
      cacheWriteInput: numberValue(raw.cache_write_input_tokens),
      output: numberValue(raw.output_tokens),
      reasoningOutput: numberValue(raw.reasoning_output_tokens),
    };
    if (totalTokens(tokens) === 0) continue;
    const tuple = [tokens.input, tokens.cachedInput, tokens.cacheWriteInput, tokens.output, tokens.reasoningOutput];
    entries.push({
      dedupeKey: `${timestampMs}:${tuple.join(":")}`,
      date: localDate(timestampMs),
      timestampMs,
      cwd,
      model,
      tokens,
    });
  }

  if (session) {
    try {
      session.updatedAt = fs.statSync(file).mtimeMs;
    } catch {
      // Keep zero; callers will still have the session id/cwd as a fallback.
    }
  }
  return { entries, quotas, session };
}

async function scan(root: string, nowMs: number, includeArchived = true): Promise<ScanResult> {
  const started = Date.now();
  const paths = findJsonl(path.join(root, "sessions"));
  if (includeArchived) findJsonl(path.join(root, "archived_sessions"), paths);
  const files: ParsedFile[] = [];

  for (const file of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const cached = cache.get(file);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      // Staleness is relative to now, so refresh it even when parsing is cached.
      const quotas = cached.quotas.map((quota) => ({
        ...quota,
        primary: quota.primary ? { ...quota.primary, stale: quota.primary.resetsAt <= nowMs } : undefined,
        secondary: quota.secondary
          ? { ...quota.secondary, stale: quota.secondary.resetsAt <= nowMs }
          : undefined,
      }));
      files.push({ ...cached, quotas });
      continue;
    }
    const parsed = await parseFile(file, nowMs);
    const slot: CacheSlot = { ...parsed, size: stat.size, mtimeMs: stat.mtimeMs };
    cache.set(file, slot);
    files.push(slot);
  }
  return { files, scanMs: Date.now() - started };
}

function dedupe(files: ParsedFile[]): UsageEntry[] {
  const seen = new Set<string>();
  const entries: UsageEntry[] = [];
  for (const file of files) {
    for (const entry of file.entries) {
      if (seen.has(entry.dedupeKey)) continue;
      seen.add(entry.dedupeKey);
      entries.push(entry);
    }
  }
  return entries;
}

function addToWindow(window: CodexUsageWindow, entry: UsageEntry): void {
  window.requests += 1;
  addTokens(window.tokens, entry.tokens);
}

function latestQuota(files: ParsedFile[]): CodexQuotaSnapshot | undefined {
  let latest: CodexQuotaSnapshot | undefined;
  for (const file of files) {
    for (const quota of file.quotas) {
      if (!latest || quota.reportedAt > latest.reportedAt) latest = quota;
    }
  }
  return latest;
}

function failedUsage(reason: string): CodexUsageResult {
  return {
    ok: false,
    reason,
    today: emptyWindow(),
    last7: emptyWindow(),
    last30: emptyWindow(),
    days: [],
    byProject: [],
    byModel: [],
    scanMs: 0,
  };
}

export async function getCodexUsage(rootOverride?: string, nowMs = Date.now()): Promise<CodexUsageResult> {
  const root = codexHome(rootOverride);
  if (!fs.existsSync(path.join(root, "sessions"))) {
    return failedUsage(`No ${rootOverride ? root : "~/.codex/sessions"} directory — has Codex run locally?`);
  }

  const { files, scanMs } = await scan(root, nowMs, true);
  const entries = dedupe(files);
  const todayDate = daysAgo(nowMs, 0);
  const from7 = daysAgo(nowMs, 6);
  const from30 = daysAgo(nowMs, 29);
  const today = emptyWindow();
  const last7 = emptyWindow();
  const last30 = emptyWindow();
  const byDay = new Map<string, number>();
  const byProject = new Map<string, CodexUsageBucket>();
  const byModel = new Map<string, CodexUsageBucket>();

  const bucket = (map: Map<string, CodexUsageBucket>, key: string, label: string) => {
    let value = map.get(key);
    if (!value) {
      value = { key, label, ...emptyWindow() };
      map.set(key, value);
    }
    return value;
  };

  for (const entry of entries) {
    if (entry.date >= from30 && entry.date <= todayDate) {
      addToWindow(last30, entry);
      byDay.set(entry.date, (byDay.get(entry.date) ?? 0) + totalTokens(entry.tokens));
      addToWindow(bucket(byProject, entry.cwd || "unknown", projectLabel(entry.cwd)), entry);
      addToWindow(bucket(byModel, entry.model || "unknown", entry.model || "unknown"), entry);
    }
    if (entry.date >= from7 && entry.date <= todayDate) addToWindow(last7, entry);
    if (entry.date === todayDate) addToWindow(today, entry);
  }

  const days = Array.from({ length: 30 }, (_, index) => {
    const date = daysAgo(nowMs, 29 - index);
    return { date, tokens: byDay.get(date) ?? 0 };
  });
  const byTokens = (a: CodexUsageBucket, b: CodexUsageBucket) =>
    totalTokens(b.tokens) - totalTokens(a.tokens);

  return {
    ok: true,
    today,
    last7,
    last30,
    days,
    byProject: [...byProject.values()].sort(byTokens),
    byModel: [...byModel.values()].sort(byTokens),
    quota: latestQuota(files),
    scanMs,
  };
}

function readSessionIndex(root: string): Map<string, string> {
  const names = new Map<string, string>();
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, "session_index.jsonl"), "utf8");
  } catch {
    return names;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (typeof row.id === "string" && typeof row.thread_name === "string") {
        names.set(row.id, row.thread_name);
      }
    } catch {
      // Ignore partially-written or obsolete index rows.
    }
  }
  return names;
}

function stateDatabases(root: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root).filter((name) => /^state_\d+\.sqlite$/.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => path.join(root, name))
    .sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });
}

function readThreads(root: string, limit: number): CodexSession[] | null {
  const indexNames = readSessionIndex(root);
  for (const dbPath of stateDatabases(root)) {
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const columns = new Set(
        (db.prepare("PRAGMA table_info(threads)").all() as { name: string }[]).map((row) => row.name)
      );
      const required = ["id", "cwd", "title", "archived", "tokens_used", "updated_at"];
      if (!required.every((column) => columns.has(column))) continue;

      const optional = (name: string, fallback: string) => (columns.has(name) ? name : fallback);
      const updated = columns.has("updated_at_ms")
        ? "COALESCE(NULLIF(updated_at_ms, 0), updated_at * 1000)"
        : "updated_at * 1000";
      const rows = db
        .prepare(
          `SELECT id, cwd, title,
            ${optional("name", "NULL")} AS name,
            ${optional("first_user_message", "''")} AS first_user_message,
            ${optional("model", "NULL")} AS model,
            ${optional("reasoning_effort", "NULL")} AS reasoning_effort,
            tokens_used, ${updated} AS updated_at_ms
           FROM threads
           WHERE archived = 0
           ORDER BY ${updated} DESC
           LIMIT ?`
        )
        .all(limit) as ThreadRow[];
      return rows.map((row) => ({
        id: row.id,
        cwd: row.cwd,
        projectLabel: projectLabel(row.cwd),
        title:
          indexNames.get(row.id) || row.name || row.title || row.first_user_message || "(untitled session)",
        model: row.model ?? undefined,
        reasoningEffort: row.reasoning_effort ?? undefined,
        tokensUsed: row.tokens_used,
        updatedAt: row.updated_at_ms,
      }));
    } catch {
      // Try an older/newer compatible state database, then transcript fallback.
    } finally {
      db?.close();
    }
  }
  return null;
}

export async function listCodexSessions(
  limit = 40,
  rootOverride?: string
): Promise<CodexSessionsResult> {
  const root = codexHome(rootOverride);
  const sessionsDir = path.join(root, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return { ok: false, reason: `No ${rootOverride ? sessionsDir : "~/.codex/sessions"} directory`, sessions: [] };
  }
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 40, 100));
  const fromDb = readThreads(root, safeLimit);
  if (fromDb) return { ok: true, sessions: fromDb };

  const names = readSessionIndex(root);
  const { files } = await scan(root, Date.now(), false);
  const sessions = files
    .flatMap((file) => (file.session ? [file.session] : []))
    .map<CodexSession>((session) => ({
      id: session.id,
      cwd: session.cwd,
      projectLabel: projectLabel(session.cwd),
      title: names.get(session.id) ?? "(untitled session)",
      model: session.model,
      tokensUsed: 0,
      updatedAt: session.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, safeLimit);
  return { ok: true, sessions };
}

export function validateCodexResumeTarget(sessionId: string, cwd: string): string | null {
  if (!UUID_RE.test(sessionId)) return "Invalid Codex session id";
  if (!cwd || /[\n\r\0\"]/.test(cwd)) return "Invalid Codex working directory";
  try {
    if (!fs.statSync(cwd).isDirectory()) return "Codex working directory no longer exists";
  } catch {
    return "Codex working directory no longer exists";
  }
  return null;
}

