// Manages long-running local processes (dev servers, watchers, tools like
// opencode) started from the Development tab. This is NOT a terminal
// emulator — no PTY, no interactive stdin. We only spawn, track, stop, and
// tail stdout/stderr; the user interacts with the process's own web UI
// (opened via `url`/`autoOpenUrl`), not a console here.
//
// Runtime state lives entirely in the in-memory `tracked` Map below, keyed
// by the same `id` used in config.json's `processes` list. A process that's
// never been started this session simply has no entry — callers (the
// renderer) treat a missing id as "stopped, no logs", using the config list
// itself as the source of truth for what processes *exist*.

import { spawn, execFile, type ChildProcess } from "node:child_process";
import type { ActionResult, ProcessConfig, ProcessStatus } from "../../shared/types";

const MAX_TRACKED_LOG_CHUNKS = 500; // ring-buffer cap, bounds memory for chatty processes
const STATUS_LOG_CHUNKS = 100; // how much of the tail a status poll actually returns
const STOP_ESCALATE_MS = 3000; // SIGTERM grace period before escalating to SIGKILL

interface TrackedProcess {
  child: ChildProcess | null;
  logs: string[];
  exitCode: number | null;
}

const tracked = new Map<string, TrackedProcess>();

function appendLog(id: string, chunk: string): void {
  const t = tracked.get(id);
  if (!t) return;
  t.logs.push(chunk);
  if (t.logs.length > MAX_TRACKED_LOG_CHUNKS) {
    t.logs.splice(0, t.logs.length - MAX_TRACKED_LOG_CHUNKS);
  }
}

// Sends a signal to the whole process group, not just the parent — a dev
// server or a tool like opencode that forks its own children would
// otherwise survive a plain `child.kill()` as an orphan still serving
// `url`. Requires the child to have been spawned with `detached: true`
// (POSIX setsid), which makes it its own group leader (pid === pgid), so
// `-pid` addresses the whole group.
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group is already gone — nothing to do.
  }
}

export function startProcess(procConfig: ProcessConfig): ActionResult {
  const existing = tracked.get(procConfig.id);
  if (existing?.child) return { ok: false, reason: "Already running" };

  let child: ChildProcess;
  try {
    child = spawn(procConfig.command, procConfig.args ?? [], {
      ...(procConfig.cwd ? { cwd: procConfig.cwd } : {}),
      // Windows has no process-group signaling to speak of — `taskkill /T`
      // walks the actual parent/child tree instead, so detaching there buys
      // nothing and would just spawn a stray console.
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  const entry: TrackedProcess = { child, logs: [], exitCode: null };
  tracked.set(procConfig.id, entry);

  child.stdout?.on("data", (buf: Buffer) => appendLog(procConfig.id, buf.toString()));
  child.stderr?.on("data", (buf: Buffer) => appendLog(procConfig.id, buf.toString()));

  // A missing binary (ENOENT) and similar spawn failures surface here
  // asynchronously — Node only throws synchronously out of spawn() itself
  // for malformed arguments/options, not for "command not found".
  child.on("error", (err) => {
    appendLog(procConfig.id, `[error] ${err.message}\n`);
    const t = tracked.get(procConfig.id);
    if (t) t.child = null;
  });

  child.on("exit", (code) => {
    const t = tracked.get(procConfig.id);
    if (t) {
      t.exitCode = code;
      t.child = null;
    }
  });

  return { ok: true };
}

export function stopProcess(id: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    const entry = tracked.get(id);
    const pid = entry?.child?.pid;
    if (!entry?.child || pid == null) {
      resolve({ ok: false, reason: "Not running" });
      return;
    }
    const child = entry.child;

    const escalate = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return; // already gone
      killGroup(pid, "SIGKILL");
    }, STOP_ESCALATE_MS);
    child.once("exit", () => clearTimeout(escalate));

    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], (err) => {
        clearTimeout(escalate);
        resolve(err ? { ok: false, reason: err.message } : { ok: true });
      });
      return;
    }

    killGroup(pid, "SIGTERM");
    resolve({ ok: true });
  });
}

export function getStatus(id: string): ProcessStatus {
  const entry = tracked.get(id);
  if (!entry) return { id, running: false, exitCode: null, logs: [] };
  return {
    id,
    running: !!entry.child,
    exitCode: entry.exitCode,
    logs: entry.logs.slice(-STATUS_LOG_CHUNKS),
  };
}

export function getAllStatus(): ProcessStatus[] {
  return Array.from(tracked.keys()).map(getStatus);
}

// Called on app quit so closing the dashboard never leaves an orphaned
// server running. Only touches processes still tracked as running.
export function stopAll(): Promise<void> {
  const running = Array.from(tracked.entries()).filter(([, t]) => t.child);
  return Promise.all(running.map(([id]) => stopProcess(id))).then(() => undefined);
}
