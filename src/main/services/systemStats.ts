// Host machine vitals for the Stats tab: CPU, memory, uptime, battery,
// storage, network throughput, and public IP. macOS-only for now, matching
// this app's existing convention (Docker/Spotify/launcher/forklift are all
// macOS-specific with fail-soft stubs elsewhere) — `df`, `pmset`, `vm_stat`,
// `sysctl`, and `netstat` are all BSD/macOS-specific tools or flag dialects.
// No PATH-widening needed (unlike docker.ts): these all live at base-system
// paths already on launchd's bare PATH, unlike Docker's Homebrew install.

import { execFile } from "node:child_process";
import os from "node:os";
import { createNetworkCollector } from "./networkStats";
import path from "node:path";
import type {
  PublicIpResult,
  StorageStatsResult,
  SystemStatsResult,
  TopProcessesResult,
} from "../../shared/types";

const TIMEOUT_MS = 5000;
const NOT_SUPPORTED_REASON = "Not supported on this platform yet";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cpuSample(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const t of Object.values(cpu.times)) total += t;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

async function readCpuPercent(): Promise<number> {
  const a = cpuSample();
  await sleep(300);
  const b = cpuSample();
  const deltaIdle = b.idle - a.idle;
  const deltaTotal = b.total - a.total;
  if (deltaTotal <= 0) return 0;
  return Math.max(0, Math.min(100, 100 * (1 - deltaIdle / deltaTotal)));
}

// "Pages free:                   5246." -> { "Pages free": 5246 }
function parseVmStat(text: string): { pageSize: number; pages: Record<string, number> } {
  const headerMatch = text.match(/page size of (\d+) bytes/);
  const pageSize = headerMatch ? Number(headerMatch[1]) : 4096;
  const pages: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^"?([A-Za-z][A-Za-z0-9 _-]*?)"?:\s+(\d+)\.?$/);
    if (m) pages[m[1]] = Number(m[2]);
  }
  return { pageSize, pages };
}

function parseSwapUsage(text: string): { totalBytes: number; usedBytes: number } {
  const m = text.match(/total\s*=\s*([\d.]+)M\s+used\s*=\s*([\d.]+)M/);
  if (!m) return { totalBytes: 0, usedBytes: 0 };
  return {
    totalBytes: Math.round(Number(m[1]) * 1024 * 1024),
    usedBytes: Math.round(Number(m[2]) * 1024 * 1024),
  };
}

function parseBattery(text: string): SystemStatsResult["battery"] {
  const percentMatch = text.match(/(\d+)%;\s*([a-zA-Z]+)/);
  if (!percentMatch) return undefined;
  const sourceMatch = text.match(/Now drawing from '([^']+)'/);
  return {
    percent: Number(percentMatch[1]),
    charging: percentMatch[2] === "charging",
    powerSource: sourceMatch ? sourceMatch[1] : "Unknown",
  };
}

export async function getSystemStats(): Promise<SystemStatsResult> {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      reason: NOT_SUPPORTED_REASON,
      cpuPercent: 0,
      loadAvg: [0, 0, 0],
      uptimeSeconds: 0,
      memory: {
        totalBytes: 0,
        usedBytes: 0,
        freeBytes: 0,
        wiredBytes: 0,
        compressedBytes: 0,
        cachedBytes: 0,
        swapUsedBytes: 0,
        swapTotalBytes: 0,
      },
    };
  }

  try {
    const [cpuPercent, vmStatText, swapText, battText] = await Promise.all([
      readCpuPercent(),
      run("vm_stat", []),
      run("sysctl", ["vm.swapusage"]).catch(() => ""),
      run("pmset", ["-g", "batt"]).catch(() => ""),
    ]);

    const { pageSize, pages } = parseVmStat(vmStatText);
    const totalBytes = os.totalmem();
    const freeBytes = (pages["Pages free"] ?? 0) * pageSize;
    const wiredBytes = (pages["Pages wired down"] ?? 0) * pageSize;
    const compressedBytes = (pages["Pages occupied by compressor"] ?? 0) * pageSize;
    const cachedBytes = (pages["File-backed pages"] ?? 0) * pageSize;
    const swap = parseSwapUsage(swapText);

    return {
      ok: true,
      cpuPercent,
      loadAvg: os.loadavg() as [number, number, number],
      uptimeSeconds: os.uptime(),
      memory: {
        totalBytes,
        usedBytes: totalBytes - freeBytes,
        freeBytes,
        wiredBytes,
        compressedBytes,
        cachedBytes,
        swapUsedBytes: swap.usedBytes,
        swapTotalBytes: swap.totalBytes,
      },
      battery: parseBattery(battText),
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Couldn't read system stats",
      cpuPercent: 0,
      loadAvg: [0, 0, 0],
      uptimeSeconds: 0,
      memory: {
        totalBytes: 0,
        usedBytes: 0,
        freeBytes: 0,
        wiredBytes: 0,
        compressedBytes: 0,
        cachedBytes: 0,
        swapUsedBytes: 0,
        swapTotalBytes: 0,
      },
    };
  }
}

// macOS's APFS layout makes a naive `df -k` show 8+ confusing rows: the
// sealed system snapshot at "/" (near-empty), several /System/Volumes/*
// pseudo-mounts, and the real writable data volume at
// /System/Volumes/Data — which is the one that actually fills up and the
// number Finder/"About This Mac" shows. Prefer it, labeled "Macintosh HD";
// fall back to "/" only if that volume doesn't exist (older non-APFS setup).
function parseDf(text: string): StorageStatsResult["volumes"] {
  const lines = text.trim().split("\n").slice(1);
  type Row = { filesystem: string; totalKb: number; usedKb: number; freeKb: number; mount: string };
  const rows: Row[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const [filesystem, totalKb, usedKb, freeKb, , , , , ...mountParts] = parts;
    rows.push({
      filesystem,
      totalKb: Number(totalKb),
      usedKb: Number(usedKb),
      freeKb: Number(freeKb),
      mount: mountParts.join(" "),
    });
  }

  const volumes: StorageStatsResult["volumes"] = [];
  const dataVolume = rows.find((r) => r.mount === "/System/Volumes/Data");
  const rootVolume = rows.find((r) => r.mount === "/");
  const main = dataVolume ?? rootVolume;
  if (main) {
    volumes.push(toVolume("Macintosh HD", main));
  }
  for (const row of rows) {
    if (!row.mount.startsWith("/Volumes/")) continue;
    if (row.filesystem === "devfs" || row.filesystem.startsWith("map")) continue;
    volumes.push(toVolume(row.mount.slice("/Volumes/".length), row));
  }
  return volumes;

  function toVolume(name: string, row: Row): StorageStatsResult["volumes"][number] {
    const totalBytes = row.totalKb * 1024;
    const usedBytes = row.usedKb * 1024;
    const freeBytes = row.freeKb * 1024;
    return {
      name,
      mountPoint: row.mount,
      totalBytes,
      usedBytes,
      freeBytes,
      usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
    };
  }
}

export async function getStorageStats(): Promise<StorageStatsResult> {
  if (process.platform !== "darwin") {
    return { ok: false, reason: NOT_SUPPORTED_REASON, volumes: [] };
  }
  try {
    const text = await run("df", ["-k"]);
    return { ok: true, volumes: parseDf(text) };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Couldn't read storage stats",
      volumes: [],
    };
  }
}

export const getNetworkStats = createNetworkCollector(run);

function parsePs(text: string): TopProcessesResult["processes"] {
  const lines = text.trim().split("\n").slice(1);
  const processes: TopProcessesResult["processes"] = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
    if (!m) continue;
    const [, pid, rssKb, memPercent, comm] = m;
    processes.push({
      pid: Number(pid),
      name: path.basename(comm),
      memoryBytes: Number(rssKb) * 1024,
      memoryPercent: Number(memPercent),
    });
  }
  return processes.sort((a, b) => b.memoryBytes - a.memoryBytes);
}

export async function getTopMemoryProcesses(limit = 10): Promise<TopProcessesResult> {
  if (process.platform !== "darwin") {
    return { ok: false, reason: NOT_SUPPORTED_REASON, processes: [] };
  }
  try {
    const text = await run("ps", ["-eo", "pid,rss,%mem,comm"]);
    return { ok: true, processes: parsePs(text).slice(0, limit) };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Couldn't read process list",
      processes: [],
    };
  }
}

export async function getPublicIp(): Promise<PublicIpResult> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `Lookup failed (HTTP ${res.status})`, checkedAt: Date.now() };
    const data = (await res.json()) as { ip?: string };
    if (!data.ip) return { ok: false, reason: "Unexpected response", checkedAt: Date.now() };
    return { ok: true, ip: data.ip, checkedAt: Date.now() };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Couldn't reach IP lookup service",
      checkedAt: Date.now(),
    };
  }
}
