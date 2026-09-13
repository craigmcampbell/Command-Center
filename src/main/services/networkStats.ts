import os from "node:os";
import type { NetworkInterfaceInfo, NetworkStatsResult, NetworkSample } from "../../shared/types";

type Counters = { received: number; sent: number };
type Run = (command: string, args: string[]) => Promise<string>;

export function parseInterfaceCounters(text: string): Map<string, Counters> {
  const result = new Map<string, Counters>();
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (!fields[2]?.startsWith("<Link#")) continue;
    // Address is optional; the trailing seven counters have a stable order.
    const counters = fields.slice(-7).map(Number);
    if (counters.length === 7 && counters.every(Number.isFinite)) {
      result.set(fields[0].replace(/\*$/, ""), { received: counters[2], sent: counters[5] });
    }
  }
  return result;
}

export function parseProcessCounters(text: string): Map<string, Counters & { name: string; pid: number }> {
  const result = new Map<string, Counters & { name: string; pid: number }>();
  const lines = text.trim().split("\n");
  const header = lines[0]?.split(",") ?? [];
  const incoming = header.indexOf("bytes_in");
  const outgoing = header.indexOf("bytes_out");
  if (incoming < 0 || outgoing < 0) throw new Error("Unrecognized app bandwidth output");
  for (const line of lines.slice(1)) {
    const fields = line.split(",");
    const match = fields[0]?.match(/^(.*)\.(\d+)$/);
    const received = Number(fields[incoming]);
    const sent = Number(fields[outgoing]);
    if (match && Number.isFinite(received) && Number.isFinite(sent)) {
      result.set(fields[0], { name: match[1], pid: Number(match[2]), received, sent });
    }
  }
  return result;
}

export class NetworkTracker {
  private previous = new Map<string, Counters>();
  private previousAt = 0;
  private sessions = new Map<string, { since: number; received: number; sent: number; history: NetworkSample[] }>();

  sample(counters: Map<string, Counters>, now: number): Map<string, Omit<NetworkInterfaceInfo, "name" | "address">> {
    const result = new Map<string, Omit<NetworkInterfaceInfo, "name" | "address">>();
    for (const [name, current] of counters) {
      const previous = this.previous.get(name);
      let session = this.sessions.get(name);
      const valid = previous && now > this.previousAt && current.received >= previous.received && current.sent >= previous.sent;
      if (!session || !valid) {
        session = { since: now, received: 0, sent: 0, history: [] };
        this.sessions.set(name, session);
      }
      const received = valid ? current.received - previous.received : 0;
      const sent = valid ? current.sent - previous.sent : 0;
      const seconds = (now - this.previousAt) / 1000;
      const downloadBytesPerSec = valid ? received / seconds : null;
      const uploadBytesPerSec = valid ? sent / seconds : null;
      session.received += received;
      session.sent += sent;
      if (downloadBytesPerSec !== null && uploadBytesPerSec !== null) {
        session.history.push({ at: now, downloadBytesPerSec, uploadBytesPerSec });
      }
      session.history = session.history.filter((point) => point.at >= now - 5 * 60_000).slice(-300);
      result.set(name, {
        downloadBytesPerSec, uploadBytesPerSec, sessionStartedAt: session.since,
        downloadedBytes: session.received, uploadedBytes: session.sent, history: [...session.history],
      });
    }
    for (const name of this.sessions.keys()) if (!counters.has(name)) this.sessions.delete(name);
    this.previous = counters;
    this.previousAt = now;
    return result;
  }
}

// Keep observed transfers after a process goes idle or exits so brief bursts
// remain discoverable. Ranking uses the rolling total, never the latest rate.
export class AppNetworkTracker {
  private previous: ReturnType<typeof parseProcessCounters> | undefined;
  private previousAt = 0;
  private history = new Map<string, { name: string; pid: number; transfers: { at: number; bytes: number }[] }>();

  resetBaseline(): void {
    this.previous = undefined;
  }

  sample(current: ReturnType<typeof parseProcessCounters>, now: number): NonNullable<NetworkStatsResult["apps"]> {
    const warmingUp = !this.previous;
    const seconds = (now - this.previousAt) / 1000;
    const rates = new Map<string, { downloadBytesPerSec: number; uploadBytesPerSec: number }>();
    for (const [key, process] of current) {
      const previous = this.previous?.get(key);
      if (!previous || seconds <= 0 || process.received < previous.received || process.sent < previous.sent) continue;
      const received = process.received - previous.received;
      const sent = process.sent - previous.sent;
      rates.set(key, { downloadBytesPerSec: received / seconds, uploadBytesPerSec: sent / seconds });
      if (received + sent > 0) {
        const entry = this.history.get(key) ?? { name: process.name, pid: process.pid, transfers: [] };
        entry.transfers.push({ at: now, bytes: received + sent });
        this.history.set(key, entry);
      }
    }
    const processes: NonNullable<NetworkStatsResult["apps"]>["processes"] = [];
    for (const [key, entry] of this.history) {
      entry.transfers = entry.transfers.filter((transfer) => transfer.at > now - 300_000);
      if (!entry.transfers.length) { this.history.delete(key); continue; }
      const rate = rates.get(key);
      processes.push({
        name: entry.name, pid: entry.pid,
        downloadBytesPerSec: rate?.downloadBytesPerSec ?? 0,
        uploadBytesPerSec: rate?.uploadBytesPerSec ?? 0,
        recentBytes: entry.transfers.reduce((total, transfer) => total + transfer.bytes, 0),
        state: !current.has(key) ? "ended" : !rate ? "measuring" : rate.downloadBytesPerSec + rate.uploadBytesPerSec > 0 ? "active" : "idle",
      });
    }
    processes.sort((a, b) => b.recentBytes - a.recentBytes || a.name.localeCompare(b.name) || a.pid - b.pid);
    this.previous = current;
    this.previousAt = now;
    return { ok: true, warmingUp: warmingUp && processes.length === 0, processes };
  }
}

export function createNetworkCollector(run: Run) {
  const tracker = new NetworkTracker();
  const appTracker = new AppNetworkTracker();
  let pending: Promise<NetworkStatsResult> | undefined;
  async function collect(): Promise<NetworkStatsResult> {
    if (process.platform !== "darwin") return { ok: false, reason: "Not supported on this platform yet", interfaces: [] };
    try {
      const [counterResult, routeResult, appResult] = await Promise.allSettled([
        run("netstat", ["-ib"]).then((text) => ({ text, at: Date.now() })),
        run("route", ["-n", "get", "default"]).catch(() => run("route", ["-n", "get", "-inet6", "default"])),
        run("nettop", ["-P", "-L", "1", "-n", "-x", "-J", "bytes_in,bytes_out", "-t", "external"]).then((text) => ({ text, at: Date.now() })),
      ]);
      if (counterResult.status === "rejected") throw counterResult.reason;
      const now = counterResult.value.at;
      const samples = tracker.sample(parseInterfaceCounters(counterResult.value.text), now);
      const addresses = os.networkInterfaces();
      const interfaces: NetworkInterfaceInfo[] = [];
      for (const [name, addrs] of Object.entries(addresses)) {
        const external = addrs?.filter((addr) => !addr.internal) ?? [];
        const address = external.find((addr) => addr.family === "IPv4") ?? external[0];
        const sample = samples.get(name);
        if (address && sample) interfaces.push({ name, address: address.address, ...sample });
      }
      const defaultName = routeResult.status === "fulfilled" ? routeResult.value.match(/interface:\s*(\S+)/)?.[1] : undefined;
      let apps: NetworkStatsResult["apps"];
      try {
        if (appResult.status === "rejected") throw appResult.reason;
        apps = appTracker.sample(parseProcessCounters(appResult.value.text), appResult.value.at);
      } catch (err) {
        appTracker.resetBaseline();
        apps = { ok: false, reason: err instanceof Error ? err.message : "App bandwidth unavailable", processes: [] };
      }
      return { ok: true, interfaces, primary: interfaces.find((iface) => iface.name === defaultName), apps };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Couldn't read network stats", interfaces: [] };
    }
  }
  return (): Promise<NetworkStatsResult> => {
    if (!pending) pending = collect().finally(() => { pending = undefined; });
    return pending;
  };
}
