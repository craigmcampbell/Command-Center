import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCodexUsage,
  listCodexSessions,
  validateCodexResumeTarget,
} from "./codexUsage";

const roots: string[] = [];
const NOW = Date.parse("2026-09-01T17:00:00-05:00");
const ACTIVE_ID = "01a05d3e-9662-79f3-b50c-63e70fdbb80c";
const ARCHIVED_ID = "01a04eee-f6ad-7543-a27d-77a87395fd2d";

interface FakeState {
  columns: string[];
  rows: Record<string, unknown>[];
}

// Production uses the repo's Electron-ABI better-sqlite3 build. Tests run in
// host Node, so fake the narrow read-only API rather than rebuilding the native
// dependency for the wrong runtime.
vi.mock("better-sqlite3", () => ({
  default: class FakeDatabase {
    private state: FakeState;
    constructor(file: string) {
      this.state = JSON.parse(fs.readFileSync(file, "utf8")) as FakeState;
    }
    prepare(sql: string) {
      if (sql.startsWith("PRAGMA")) {
        return { all: () => this.state.columns.map((name) => ({ name })) };
      }
      return {
        all: (limit: number) =>
          this.state.rows
            .filter((row) => row.archived === 0)
            .sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
            .slice(0, limit)
            .map((row) => ({ ...row, updated_at_ms: Number(row.updated_at) * 1000 })),
      };
    }
    close() {}
  },
}));

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "command-center-codex-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "sessions", "2026", "09", "01"), { recursive: true });
  fs.mkdirSync(path.join(root, "archived_sessions"), { recursive: true });
  return root;
}

function writeJsonl(file: string, records: unknown[], malformed = false): void {
  const lines = records.map((record) => JSON.stringify(record));
  if (malformed) lines.push('{"type":"event_msg"');
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

function sessionMeta(id: string, cwd: string, timestamp: string) {
  return { type: "session_meta", timestamp, payload: { id, session_id: id, cwd } };
}

function turn(timestamp: string, cwd: string, model: string) {
  return { type: "turn_context", timestamp, payload: { cwd, model } };
}

function token(
  timestamp: string,
  usage: Record<string, number> | null,
  rateLimits?: Record<string, unknown>
) {
  return {
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      info: usage ? { last_token_usage: usage } : null,
      rate_limits: rateLimits,
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Codex local usage", () => {
  it("aggregates local days and contexts without double-counting token subsets or copied events", async () => {
    const root = makeRoot();
    const projectA = path.join(root, "alpha");
    const projectB = path.join(root, "beta");
    const firstUsage = {
      input_tokens: 100,
      cached_input_tokens: 40,
      cache_write_input_tokens: 5,
      output_tokens: 20,
      reasoning_output_tokens: 8,
      total_tokens: 120,
    };
    const todayUsage = {
      input_tokens: 200,
      cached_input_tokens: 150,
      cache_write_input_tokens: 0,
      output_tokens: 30,
      reasoning_output_tokens: 10,
      total_tokens: 230,
    };
    const first = token("2026-08-31T14:00:00.000Z", firstUsage);
    const today = token("2026-09-01T20:00:00.000Z", todayUsage, {
      plan_type: "plus",
      primary: { used_percent: 25, window_minutes: 300, resets_at: (NOW + 60_000) / 1000 },
      secondary: { used_percent: 5, window_minutes: 10_080, resets_at: (NOW + 86_400_000) / 1000 },
      credits: { has_credits: false, unlimited: false, balance: "0" },
    });
    const records = [
      sessionMeta(ACTIVE_ID, projectA, "2026-08-31T13:59:00.000Z"),
      turn("2026-08-31T13:59:30.000Z", projectA, "model-a"),
      first,
      turn("2026-09-01T19:59:00.000Z", projectB, "model-b"),
      today,
      token("2026-07-31T12:00:00.000Z", { ...firstUsage, input_tokens: 999 }),
    ];
    writeJsonl(path.join(root, "sessions", "2026", "09", "01", "rollout.jsonl"), records, true);
    // Forked/copied history retains the original event timestamp and usage tuple.
    writeJsonl(path.join(root, "archived_sessions", "copied.jsonl"), [
      sessionMeta(ARCHIVED_ID, projectB, "2026-09-01T19:58:00.000Z"),
      turn("2026-09-01T19:59:00.000Z", projectB, "model-b"),
      today,
    ]);

    const result = await getCodexUsage(root, NOW);
    expect(result.ok).toBe(true);
    expect(result.today.requests).toBe(1);
    expect(result.today.tokens).toMatchObject({ input: 200, cachedInput: 150, output: 30, reasoningOutput: 10 });
    expect(result.last7.requests).toBe(2);
    expect(result.last30.tokens.input + result.last30.tokens.output).toBe(350);
    expect(result.byProject.map((row) => row.label).sort()).toEqual(["alpha", "beta"]);
    expect(result.byModel.map((row) => row.label).sort()).toEqual(["model-a", "model-b"]);
    expect(result.quota?.planType).toBe("plus");
    expect(result.quota?.primary).toMatchObject({ usedPercent: 25, windowMinutes: 300, stale: false });
  });

  it("supports legacy relative reset fields and expires stale snapshots", async () => {
    const root = makeRoot();
    const timestamp = "2026-09-01T20:00:00.000Z";
    writeJsonl(path.join(root, "sessions", "2026", "09", "01", "legacy.jsonl"), [
      sessionMeta(ACTIVE_ID, root, timestamp),
      token(timestamp, null, {
        primary: { used_percent: 19, window_minutes: 299, resets_in_seconds: 600 },
      }),
    ]);
    const result = await getCodexUsage(root, Date.parse("2026-09-01T20:20:00.000Z"));
    expect(result.quota?.primary?.resetsAt).toBe(Date.parse(timestamp) + 600_000);
    expect(result.quota?.primary?.stale).toBe(true);
  });

  it("fails softly when Codex has no local session directory", async () => {
    const root = makeRoot();
    fs.rmSync(path.join(root, "sessions"), { recursive: true });
    const result = await getCodexUsage(root, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("has Codex run locally");
  });
});

describe("Codex sessions", () => {
  it("reads compatible state metadata, prefers generated names, and excludes archived rows", async () => {
    const root = makeRoot();
    fs.writeFileSync(
      path.join(root, "session_index.jsonl"),
      `${JSON.stringify({ id: ACTIVE_ID, thread_name: "Generated title" })}\n`
    );
    const columns = [
      "id", "cwd", "title", "archived", "tokens_used", "updated_at", "model", "reasoning_effort",
    ];
    fs.writeFileSync(
      path.join(root, "state_5.sqlite"),
      JSON.stringify({
        columns,
        rows: [
          { id: ACTIVE_ID, cwd: path.join(root, "project"), title: "Long raw prompt", archived: 0, tokens_used: 12345, updated_at: 100, model: "gpt-test", reasoning_effort: "high", name: null, first_user_message: "" },
          { id: ARCHIVED_ID, cwd: path.join(root, "old"), title: "Archived", archived: 1, tokens_used: 99, updated_at: 200, model: "gpt-test", reasoning_effort: "low", name: null, first_user_message: "" },
        ],
      } satisfies FakeState)
    );

    const result = await listCodexSessions(40, root);
    expect(result.ok).toBe(true);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      id: ACTIVE_ID,
      title: "Generated title",
      model: "gpt-test",
      reasoningEffort: "high",
      tokensUsed: 12345,
    });
  });

  it("falls back to transcript and session-index metadata when state schema is incompatible", async () => {
    const root = makeRoot();
    const cwd = path.join(root, "fallback-project");
    fs.mkdirSync(cwd);
    writeJsonl(path.join(root, "sessions", "2026", "09", "01", "fallback.jsonl"), [
      sessionMeta(ACTIVE_ID, cwd, "2026-09-01T20:00:00.000Z"),
      turn("2026-09-01T20:00:01.000Z", cwd, "fallback-model"),
    ]);
    fs.writeFileSync(
      path.join(root, "session_index.jsonl"),
      `${JSON.stringify({ id: ACTIVE_ID, thread_name: "Fallback title" })}\n`
    );
    fs.writeFileSync(
      path.join(root, "state_9.sqlite"),
      JSON.stringify({ columns: ["id"], rows: [] } satisfies FakeState)
    );

    const result = await listCodexSessions(40, root);
    expect(result.sessions[0]).toMatchObject({
      id: ACTIVE_ID,
      title: "Fallback title",
      model: "fallback-model",
      projectLabel: "fallback-project",
    });
  });
});

describe("Codex resume validation", () => {
  it("accepts only UUID sessions and existing safe directories", () => {
    const root = makeRoot();
    expect(validateCodexResumeTarget(ACTIVE_ID, root)).toBeNull();
    expect(validateCodexResumeTarget("not-a-session", root)).toBe("Invalid Codex session id");
    expect(validateCodexResumeTarget(ACTIVE_ID, `${root}\"bad`)).toBe("Invalid Codex working directory");
    expect(validateCodexResumeTarget(ACTIVE_ID, path.join(root, "missing"))).toContain("no longer exists");
  });
});
