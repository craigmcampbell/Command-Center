import { describe, expect, it } from "vitest";
import { AppNetworkTracker, NetworkTracker, parseInterfaceCounters, parseProcessCounters, createNetworkCollector } from "./networkStats";

describe("network counters", () => {
  it("reads link counters with and without a hardware address, ignoring address-family duplicates", () => {
    const counters = parseInterfaceCounters(`Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
lo0 16384 <Link#1> 23 0 12345 20 0 6789 0
en0 1500 <Link#2> aa:bb:cc:dd:ee:ff 10 0 9000 11 0 8000 0
en0 1500 192.168.1 192.168.1.2 10 - 9000 11 - 8000 -
gif0* 1280 <Link#3> 0 0 0 0 0 0 0`);
    expect(counters.get("lo0")).toEqual({ received: 12345, sent: 6789 });
    expect(counters.get("en0")).toEqual({ received: 9000, sent: 8000 });
    expect(counters.has("gif0")).toBe(true);
    expect(counters.size).toBe(3);
  });
  it("uses named columns and preserves process names containing dots and spaces", () => {
    expect(parseProcessCounters(",bytes_out,bytes_in,\nBrowser Helper.123,50,200,\napp.name.456,30,100,\n").get("app.name.456"))
      .toEqual({ name: "app.name", pid: 456, received: 100, sent: 30 });
    expect(() => parseProcessCounters("permission denied")).toThrow();
  });
});

const counters = (received: number, sent: number) => new Map([["en0", { received, sent }]]);
describe("network monitoring session", () => {
  it("waits for a baseline and averages over the actual full polling interval", () => {
    const tracker = new NetworkTracker();
    expect(tracker.sample(counters(1000, 2000), 1000).get("en0")?.downloadBytesPerSec).toBeNull();
    const sample = tracker.sample(counters(31000, 17000), 16000).get("en0")!;
    expect(sample.downloadBytesPerSec).toBe(2000);
    expect(sample.uploadBytesPerSec).toBe(1000);
    expect(sample.downloadedBytes).toBe(30000);
    expect(sample.uploadedBytes).toBe(15000);
    expect(sample.sessionStartedAt).toBe(1000);
    expect(sample.history).toHaveLength(1);
  });
  it("starts a new session after counter reset or interface disappearance", () => {
    const tracker = new NetworkTracker();
    tracker.sample(counters(1000, 1000), 1000);
    tracker.sample(counters(2000, 2000), 2000);
    const reset = tracker.sample(counters(1, 1), 3000).get("en0")!;
    expect(reset.downloadBytesPerSec).toBeNull();
    expect(reset.downloadedBytes).toBe(0);
    expect(reset.history).toEqual([]);
    tracker.sample(new Map(), 4000);
    expect(tracker.sample(counters(9000, 9000), 5000).get("en0")?.sessionStartedAt).toBe(5000);
  });
  it("bounds history by time while retaining session totals", () => {
    const tracker = new NetworkTracker();
    tracker.sample(counters(0, 0), 1000);
    tracker.sample(counters(1000, 1000), 2000);
    const latest = tracker.sample(counters(2000, 2000), 400000).get("en0")!;
    expect(latest.history).toHaveLength(1);
    expect(latest.downloadedBytes).toBe(2000);
  });
  it("shares overlapping polls and isolates app collector failure", async () => {
    const collect = createNetworkCollector(async (command) => {
      if (command === "nettop") throw new Error("permission denied");
      if (command === "route") return "interface: en0";
      return "en0 1500 <Link#2> aa:bb:cc:dd:ee:ff 10 0 9000 11 0 8000 0";
    });
    const first = collect();
    expect(collect()).toBe(first);
    const result = await first;
    if (process.platform === "darwin") {
      expect(result.ok).toBe(true);
      expect(result.apps?.ok).toBe(false);
    }
  });
});

const appCounters = (...rows: string[]) => parseProcessCounters(",bytes_in,bytes_out,\n" + rows.join("\n"));
describe("sustained app bandwidth", () => {
  it("ranks by recent transfer instead of the latest spike, retaining idle and exited processes", () => {
    const tracker = new AppNetworkTracker();
    tracker.sample(appCounters("Backup.1,0,0", "Browser.2,0,0"), 1000);
    tracker.sample(appCounters("Backup.1,10000,0", "Browser.2,0,0"), 2000);
    const next = tracker.sample(appCounters("Backup.1,10000,0", "Browser.2,300,100"), 3000);
    expect(next.processes.map((app) => app.name)).toEqual(["Backup", "Browser"]);
    expect(next.processes[0]).toMatchObject({ recentBytes: 10000, state: "idle", downloadBytesPerSec: 0 });
    expect(next.processes[1]).toMatchObject({ recentBytes: 400, state: "active", downloadBytesPerSec: 300, uploadBytesPerSec: 100 });
    const exited = tracker.sample(appCounters("Browser.2,300,100"), 4000);
    expect(exited.processes[0]).toMatchObject({ name: "Backup", state: "ended", recentBytes: 10000 });
    expect(tracker.sample(appCounters(), 302000).processes.map((app) => app.name)).toEqual(["Browser"]);
    expect(tracker.sample(appCounters(), 303000).processes).toEqual([]);
  });
  it("retains all processes so lower ranked transfers can be expanded", () => {
    const tracker = new AppNetworkTracker();
    tracker.sample(appCounters(...Array.from({ length: 8 }, (_, i) => `App.${i},0,0`)), 1000);
    const result = tracker.sample(appCounters(...Array.from({ length: 8 }, (_, i) => `App.${i},100,0`)), 2000);
    expect(result.processes).toHaveLength(8);
    expect(result.processes.map((app) => app.pid)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("preserves history through a failed sample and counter reset without inventing rates", () => {
    const tracker = new AppNetworkTracker();
    tracker.sample(appCounters("Backup.1,0,0"), 1000);
    tracker.sample(appCounters("Backup.1,1000,0"), 2000);
    tracker.resetBaseline();
    const recovered = tracker.sample(appCounters("Backup.1,9000,0"), 4000);
    expect(recovered.processes[0]).toMatchObject({ recentBytes: 1000, state: "measuring" });
    expect(tracker.sample(appCounters("Backup.1,1,0"), 5000).processes[0].recentBytes).toBe(1000);
    expect(tracker.sample(appCounters("Backup.1,101,0"), 6000).processes[0]).toMatchObject({ recentBytes: 1100, downloadBytesPerSec: 100 });
  });
});
