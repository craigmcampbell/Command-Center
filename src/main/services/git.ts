// Working-tree status for locally-checked-out repos, via the `git` CLI.
// Complements services/github.ts: that one asks api.github.com about CI and
// PRs, this one answers "do I have uncommitted work, and am I behind?" — a
// question that only the disk knows and that costs no API quota.
//
// Unlike services/docker.ts there's no PATH widening here: Docker Desktop
// installs outside launchd's bare PATH (which is why that file carries
// ENV_WITH_DOCKER_PATH), but `git` is at /usr/bin/git and resolves fine from
// a GUI-launched app. Don't copy that machinery over.

import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import type { GitHubRepoConfig, GitRepoStatus, GitStatusResult } from "../../shared/types";

const TIMEOUT_MS = 5000;

type GitRun =
  | { ok: true; stdout: string }
  | { ok: false; err: ExecFileException; stderr: string };

// execFile, not exec — repo paths are user-supplied and belong in argv, never
// interpolated into a shell string. Same preference as docker.ts's start/stop.
function git(cwd: string, args: string[]): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, err, stderr });
      else resolve({ ok: true, stdout });
    });
  });
}

// git reports these as plain non-zero exits with a message on stderr, so the
// only way to tell them apart is to read it.
function failureReason(err: ExecFileException, stderr: string): string {
  const text = `${stderr} ${err.message}`.toLowerCase();
  if (err.code === "ENOENT") return "git not found";
  if (/not a git repository/.test(text)) return "Not a git repository";
  if (/no such file or directory|cannot change to/.test(text)) return "Path not found";
  if (/dubious ownership/.test(text)) return "Blocked by git safe.directory";
  return stderr.trim().split("\n")[0] || "git failed";
}

interface Counts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

interface ParsedStatus extends Counts {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

// Parses `git status --porcelain=v2 --branch`. The v2 format is explicitly
// designed to be machine-read (v1 is not — it's ambiguous around renames and
// spaces in paths), so prefer it even though it's chattier.
//
//   # branch.oid <sha>
//   # branch.head <branch>          -- literal "(detached)" when detached
//   # branch.upstream <ref>         -- absent when no upstream is configured
//   # branch.ab +2 -1               -- absent when no upstream
//   1 .M N... 100644 ... <path>     -- ordinary change
//   2 R. N... ... <path>\t<orig>    -- rename/copy
//   u UU N... ... <path>            -- unmerged
//   ? <path>                        -- untracked
//   ! <path>                        -- ignored (only with --ignored)
export function parsePorcelainV2(stdout: string): ParsedStatus {
  const result: ParsedStatus = {
    branch: "(unknown)",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };

  for (const line of stdout.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      result.branch = line.slice("# branch.head ".length).trim();
    } else if (line.startsWith("# branch.upstream ")) {
      result.upstream = line.slice("# branch.upstream ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      // "+2 -1" — the signs are part of the format, not of the numbers.
      const m = /^# branch\.ab \+(\d+) -(\d+)/.exec(line);
      if (m) {
        result.ahead = Number(m[1]);
        result.behind = Number(m[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Field 2 is <XY>: X = staged state, Y = unstaged state, "." = clean.
      // A file can be both (staged edit plus further unstaged edits), so
      // these are two independent counters, not a either/or.
      const xy = line.slice(2, 4);
      if (xy[0] && xy[0] !== ".") result.staged++;
      if (xy[1] && xy[1] !== ".") result.unstaged++;
    } else if (line.startsWith("u ")) {
      result.conflicted++;
    } else if (line.startsWith("? ")) {
      result.untracked++;
    }
  }

  return result;
}

function parseLastCommit(stdout: string): GitRepoStatus["lastCommit"] {
  // NUL-separated (%x00) so a commit subject containing the delimiter can't
  // corrupt the split — subjects are arbitrary user text.
  const [hash, subject, relative] = stdout.trim().split("\0");
  if (!hash) return undefined;
  return { hash, subject: subject ?? "", relative: relative ?? "" };
}

const commitCache = new Map<string, { head: string; commit: GitRepoStatus["lastCommit"] }>();

async function getRepoStatus(repo: GitHubRepoConfig): Promise<GitRepoStatus> {
  const path = repo.localPath as string;
  const base: GitRepoStatus = {
    id: repo.id,
    label: repo.label,
    owner: repo.owner,
    path,
    ok: false,
    branch: "(unknown)",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };

  const status = await git(path, ["status", "--porcelain=v2", "--branch"]);
  if (!status.ok) {
    return { ...base, reason: failureReason(status.err, status.stderr) };
  }

  // Only worth asking once we know it's a real repo. A fresh repo with no
  // commits yet fails this call, which is fine — lastCommit stays undefined.
  const head = status.stdout.match(/^# branch.oid (.+)$/m)?.[1] ?? "";
  const cached = commitCache.get(path);
  let commit = cached?.head === head ? cached.commit : undefined;
  if (!cached || cached.head !== head) {
    const log = await git(path, ["log", "-1", "--format=%h%x00%s%x00%cI"]);
    commit = log.ok ? parseLastCommit(log.stdout) : undefined;
    if (log.ok) commitCache.set(path, { head, commit });
  }
  if (commit) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(commit.relative)) / 60_000));
    commit = { ...commit, relative: minutes < 60 ? `${minutes} minutes ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hours ago` : `${Math.floor(minutes / 1440)} days ago` };
  }

  return {
    ...base,
    ok: true,
    ...parsePorcelainV2(status.stdout),
    lastCommit: commit,
  };
}

export async function getGitStatuses(repos: GitHubRepoConfig[]): Promise<GitStatusResult> {
  const local = repos.filter((r) => r.localPath);
  if (local.length === 0) return { ok: true, repos: [] };

  const activePaths = new Set(local.map((repo) => repo.localPath));
  for (const key of commitCache.keys()) if (!activePaths.has(key)) commitCache.delete(key);
  const statuses = new Array<GitRepoStatus>(local.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, local.length) }, async () => {
    while (cursor < local.length) {
      const index = cursor++;
      statuses[index] = await getRepoStatus(local[index]);
    }
  }));

  // If every repo failed for the same "git isn't here" reason, that's one
  // global problem, not N per-repo ones — say it once.
  if (statuses.every((s) => s.reason === "git not found")) {
    return { ok: false, reason: "git not available", repos: [] };
  }

  return { ok: true, repos: statuses };
}
