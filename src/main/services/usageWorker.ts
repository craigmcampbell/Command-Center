import { app } from "electron";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type * as Claude from "./claudeUsage";
import type * as Codex from "./codexUsage";

let worker: Worker | undefined;
let sequence = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>();
function getWorker(): Worker {
  if (worker) return worker;
  const current = new Worker(path.join(__dirname, "usage-worker.js"), {
    workerData: { indexPath: path.join(app.getPath("userData"), "transcript-index.sqlite") },
  });
  worker = current;
  current.on("message", ({ id, value, error }) => {
    const request = pending.get(id);
    pending.delete(id);
    if (error) request?.reject(new Error(error));
    else request?.resolve(value);
    if (pending.size === 0) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (worker === current && pending.size === 0) {
          worker = undefined;
          void current.terminate();
        }
      }, 120_000);
      idleTimer.unref();
    }
  });
  const failed = (error: Error) => {
    if (worker !== current) return;
    worker = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  current.on("error", failed);
  current.on("exit", () => failed(new Error("Transcript worker stopped")));
  return current;
}
function invoke<T>(method: string, args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    clearTimeout(idleTimer);
    const current = getWorker();
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    current.postMessage({ id, method, args });
  });
}

function reason(error: unknown): string { return error instanceof Error ? error.message : "Unable to read usage"; }
export async function getClaudeUsage(...args: Parameters<typeof Claude.getClaudeUsage>): ReturnType<typeof Claude.getClaudeUsage> {
  try { return await invoke("getClaudeUsage", args); }
  catch (error) {
    const window = { costUsd: 0, requests: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } };
    return { ok: false, reason: reason(error), today: window, last7: window, last30: window, days: [], byProject: [], byModel: [], unpricedModels: [], scanMs: 0 };
  }
}
export async function getCodexUsage(...args: Parameters<typeof Codex.getCodexUsage>): ReturnType<typeof Codex.getCodexUsage> {
  try { return await invoke("getCodexUsage", args); }
  catch (error) {
    const window = { requests: 0, tokens: { input: 0, output: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } };
    return { ok: false, reason: reason(error), today: window, last7: window, last30: window, days: [], byProject: [], byModel: [], scanMs: 0 };
  }
}
export async function listClaudeSessions(...args: Parameters<typeof Claude.listClaudeSessions>): ReturnType<typeof Claude.listClaudeSessions> {
  try { return await invoke("listClaudeSessions", args); }
  catch (error) { return { ok: false, reason: reason(error), sessions: [] }; }
}
export async function listCodexSessions(...args: Parameters<typeof Codex.listCodexSessions>): ReturnType<typeof Codex.listCodexSessions> {
  try { return await invoke("listCodexSessions", args); }
  catch (error) { return { ok: false, reason: reason(error), sessions: [] }; }
}
