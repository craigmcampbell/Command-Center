// Token and cost accounting for Claude Code, read straight out of the
// transcripts it already writes to ~/.claude/projects. No API token, no
// network — this is local file reading.
//
// Three things here are load-bearing correctness, not optimizations:
//
//  1. DEDUPE. Resuming or forking a session copies earlier messages into the
//     new transcript, so the same request appears in several files. On this
//     machine 46.7% of usage records are duplicates — without deduping on
//     (requestId, message.id) every figure comes out roughly 1.9x too high.
//  2. RECURSIVE WALK. Subagent turns live in
//     <project>/<session-id>/subagents/agent-*.jsonl, one level deeper than
//     the session transcripts. They're real spend; a one-level scan silently
//     understates cost.
//  3. DATE-SCOPED RATES. See claudePricing.ts — intro pricing means a message's
//     cost depends on when it happened.
//
// Performance: the prefilter below is why this needs no worker process and no
// persistent cache. Transcripts are mostly enormous attachment lines; skipping
// any line without `"usage"` before JSON.parse takes a full 391MB / 43-file
// scan to well under a second.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { costOf, planFor, rateFor } from "./claudePricing";
import type {
  ClaudeSession,
  ClaudeSessionsResult,
  ClaudeTokenTotals,
  ClaudeUsageBucket,
  ClaudeUsageResult,
  ClaudeUsageWindow,
} from "../../shared/types";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

interface UsageEntry {
  requestId: string;
  messageId: string;
  date: string; // local YYYY-MM-DD
  model: string;
  cwd: string;
  sessionId: string;
  tokens: ClaudeTokenTotals;
}

interface SessionMeta {
  id: string;
  cwd: string;
  title?: string;
  lastPrompt?: string;
  updatedAt: number;
}

interface ParsedFile {
  entries: UsageEntry[];
  session?: SessionMeta; // only for top-level session transcripts
}

// Cache key includes size and mtime: transcripts are append-only, so a file
// whose size hasn't changed cannot have new usage in it. This is what keeps a
// refresh cheap as the transcript directory grows.
interface CacheSlot extends ParsedFile {
  size: number;
  mtimeMs: number;
}
const cache = new Map<string, CacheSlot>();

// Claude Code records the signed-in account in ~/.claude.json. This is only
// used to name the plan and put the API-equivalent figure in proportion —
// there is no local record of quota remaining, so this can't show how much of
// a subscription has been consumed (checked: `rateLimits` appears in
// transcripts only inside a 429 error payload, after the fact).
function readPlan(): { label: string; monthlyUsd?: number } | null {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8");
    const account = JSON.parse(raw)?.oauthAccount;
    return planFor(account?.organizationType);
  } catch {
    return null;
  }
}

function emptyTokens(): ClaudeTokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
}

function addTokens(into: ClaudeTokenTotals, from: ClaudeTokenTotals): void {
  into.input += from.input;
  into.output += from.output;
  into.cacheRead += from.cacheRead;
  into.cacheWrite5m += from.cacheWrite5m;
  into.cacheWrite1h += from.cacheWrite1h;
}

function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Recursive walk; fs.promises.glob needs Node 22 and Electron 33 ships Node 20. */
function findTranscripts(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findTranscripts(full, out);
    else if (entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

// A session transcript is <projects>/<project>/<uuid>.jsonl. Anything deeper
// (the subagents/ folder) belongs to the session named by its parent directory
// and must never be listed as a session of its own.
function sessionIdForFile(file: string): { id: string; isSessionFile: boolean } {
  const rel = path.relative(PROJECTS_DIR, file);
  const parts = rel.split(path.sep);
  const base = path.basename(file, ".jsonl");
  if (parts.length === 2) return { id: base, isSessionFile: true };
  // <project>/<session-id>/subagents/agent-x.jsonl → parent session is parts[1]
  return { id: parts[1] ?? base, isSessionFile: false };
}

async function parseFile(file: string): Promise<ParsedFile> {
  const { id: sessionId, isSessionFile } = sessionIdForFile(file);
  const entries: UsageEntry[] = [];
  let title: string | undefined;
  let lastPrompt: string | undefined;
  let cwd = "";

  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // The prefilter. Transcripts are dominated by huge attachment lines;
    // parsing them all is the difference between ~1s and a very long wait.
    const hasUsage = line.includes('"usage"');
    const isMeta = isSessionFile && (line.includes('"custom-title"') || line.includes('"last-prompt"'));
    if (!hasUsage && !isMeta) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a partially-written trailing line while Claude Code is running
    }

    const type = record.type;
    if (type === "custom-title") {
      title = (record.customTitle as string) || title;
      continue;
    }
    if (type === "last-prompt") {
      lastPrompt = (record.lastPrompt as string) || lastPrompt;
      continue;
    }
    if (type !== "assistant") continue;

    const message = record.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    if (typeof record.cwd === "string" && record.cwd) cwd = record.cwd;

    // Cache creation is reported both as a flat total and split by TTL. Prefer
    // the split (the two are priced differently); fall back to the flat number,
    // treating it as 5-minute, which is the default TTL.
    const split = usage.cache_creation as Record<string, number> | undefined;
    const flatWrite = (usage.cache_creation_input_tokens as number) ?? 0;

    entries.push({
      requestId: (record.requestId as string) ?? "",
      messageId: (message?.id as string) ?? "",
      date: localDate((record.timestamp as string) ?? ""),
      model: (message?.model as string) ?? "unknown",
      cwd: (record.cwd as string) ?? "",
      sessionId,
      tokens: {
        input: (usage.input_tokens as number) ?? 0,
        // thinking_tokens are already inside output_tokens — adding them would
        // double-count.
        output: (usage.output_tokens as number) ?? 0,
        cacheRead: (usage.cache_read_input_tokens as number) ?? 0,
        cacheWrite5m: split ? (split.ephemeral_5m_input_tokens ?? 0) : flatWrite,
        cacheWrite1h: split ? (split.ephemeral_1h_input_tokens ?? 0) : 0,
      },
    });
  }

  const parsed: ParsedFile = { entries };
  if (isSessionFile) {
    let updatedAt = 0;
    try {
      updatedAt = fs.statSync(file).mtimeMs;
    } catch {
      // fall through with 0
    }
    parsed.session = { id: sessionId, cwd, title, lastPrompt, updatedAt };
  }
  return parsed;
}

async function scan(): Promise<{ files: ParsedFile[]; scanMs: number }> {
  const started = Date.now();
  const files: ParsedFile[] = [];

  for (const file of findTranscripts(PROJECTS_DIR)) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }

    const cached = cache.get(file);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      files.push(cached);
      continue;
    }

    const parsed = await parseFile(file);
    const slot: CacheSlot = { ...parsed, size: stat.size, mtimeMs: stat.mtimeMs };
    cache.set(file, slot);
    files.push(slot);
  }

  return { files, scanMs: Date.now() - started };
}

/**
 * Flattens every file's entries, dropping requests already seen. Returns them
 * in one list so callers can aggregate however they like — the dedupe must
 * happen once, globally, or duplicated history is counted repeatedly.
 */
function dedupe(files: ParsedFile[]): UsageEntry[] {
  const seen = new Set<string>();
  const unique: UsageEntry[] = [];
  for (const file of files) {
    for (const entry of file.entries) {
      const key = `${entry.requestId}:${entry.messageId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(entry);
    }
  }
  return unique;
}

function projectLabel(cwd: string): string {
  return cwd ? path.basename(cwd) : "unknown";
}

function emptyWindow(): ClaudeUsageWindow {
  return { costUsd: 0, requests: 0, tokens: emptyTokens() };
}

function addToWindow(w: ClaudeUsageWindow, entry: UsageEntry, cost: number): void {
  w.costUsd += cost;
  w.requests += 1;
  addTokens(w.tokens, entry.tokens);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function getClaudeUsage(): Promise<ClaudeUsageResult> {
  if (!fs.existsSync(PROJECTS_DIR)) {
    return {
      ok: false,
      reason: "No ~/.claude/projects directory — has Claude Code run on this machine?",
      today: emptyWindow(),
      last7: emptyWindow(),
      last30: emptyWindow(),
      days: [],
      byProject: [],
      byModel: [],
      unpricedModels: [],
      scanMs: 0,
    };
  }

  const { files, scanMs } = await scan();
  const entries = dedupe(files);

  const today = daysAgo(0);
  const from7 = daysAgo(6);
  const from30 = daysAgo(29);

  const windows = { today: emptyWindow(), last7: emptyWindow(), last30: emptyWindow() };
  const byDay = new Map<string, number>();
  const byProject = new Map<string, ClaudeUsageBucket>();
  const byModel = new Map<string, ClaudeUsageBucket>();
  const unpriced = new Set<string>();

  const bucket = (map: Map<string, ClaudeUsageBucket>, key: string, label: string) => {
    let b = map.get(key);
    if (!b) {
      b = { key, label, costUsd: 0, requests: 0, tokens: emptyTokens() };
      map.set(key, b);
    }
    return b;
  };

  for (const entry of entries) {
    const rate = rateFor(entry.model, entry.date);
    // An unknown model still had its tokens spent. Count them, and mark the
    // row unpriced rather than letting a $0 quietly deflate the total.
    const cost = rate ? costOf(entry.tokens, rate) : 0;
    if (!rate) unpriced.add(entry.model);

    if (entry.date >= from30) {
      addToWindow(windows.last30, entry, cost);
      byDay.set(entry.date, (byDay.get(entry.date) ?? 0) + cost);

      const project = bucket(byProject, entry.cwd || "unknown", projectLabel(entry.cwd));
      project.costUsd += cost;
      project.requests += 1;
      addTokens(project.tokens, entry.tokens);

      const model = bucket(byModel, entry.model, entry.model);
      model.costUsd += cost;
      model.requests += 1;
      addTokens(model.tokens, entry.tokens);
      if (!rate) model.unpriced = true;
    }
    if (entry.date >= from7) addToWindow(windows.last7, entry, cost);
    if (entry.date === today) addToWindow(windows.today, entry, cost);
  }

  const days: ClaudeUsageResult["days"] = [];
  for (let i = 29; i >= 0; i--) {
    const date = daysAgo(i);
    days.push({ date, costUsd: byDay.get(date) ?? 0 });
  }

  const byCost = (a: ClaudeUsageBucket, b: ClaudeUsageBucket) => b.costUsd - a.costUsd;

  return {
    ok: true,
    plan: readPlan() ?? undefined,
    ...windows,
    days,
    byProject: [...byProject.values()].sort(byCost),
    byModel: [...byModel.values()].sort(byCost),
    unpricedModels: [...unpriced],
    scanMs,
  };
}

export async function listClaudeSessions(limit = 20): Promise<ClaudeSessionsResult> {
  if (!fs.existsSync(PROJECTS_DIR)) {
    return { ok: false, reason: "No ~/.claude/projects directory", sessions: [] };
  }

  const { files } = await scan();
  const entries = dedupe(files);

  // Cost per session, including any subagent turns, which carry the parent
  // session's id (see sessionIdForFile).
  const costBySession = new Map<string, { cost: number; requests: number }>();
  for (const entry of entries) {
    const rate = rateFor(entry.model, entry.date);
    const acc = costBySession.get(entry.sessionId) ?? { cost: 0, requests: 0 };
    acc.cost += rate ? costOf(entry.tokens, rate) : 0;
    acc.requests += 1;
    costBySession.set(entry.sessionId, acc);
  }

  const sessions: ClaudeSession[] = [];
  for (const file of files) {
    const meta = file.session;
    if (!meta) continue; // subagent transcript, already folded into its parent
    const acc = costBySession.get(meta.id) ?? { cost: 0, requests: 0 };
    if (acc.requests === 0) continue; // a session that never produced a turn
    sessions.push({
      id: meta.id,
      cwd: meta.cwd,
      projectLabel: projectLabel(meta.cwd),
      title: meta.title,
      lastPrompt: meta.lastPrompt,
      updatedAt: meta.updatedAt,
      requests: acc.requests,
      costUsd: acc.cost,
    });
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return { ok: true, sessions: sessions.slice(0, limit) };
}
