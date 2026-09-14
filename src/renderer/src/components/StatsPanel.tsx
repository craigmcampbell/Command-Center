import { useCallback, useEffect, useState } from "react";
import type { SystemStatsResult, StorageStatsResult, NetworkStatsResult, PublicIpResult, TopProcessesResult } from "../../../shared/types";
import { usePolling } from "../hooks/usePolling";
import UtilizationWidget from "./UtilizationWidget";
import SystemStatsWidget from "./SystemStatsWidget";
import StorageWidget from "./StorageWidget";
import NetworkWidget from "./NetworkWidget";
import TopProcessesWidget from "./TopProcessesWidget";

const STATS_HISTORY_LENGTH = 40;
export default function StatsPanel({ visible, refreshSeconds, publicIpEnabled, publicIpMinutes, backgroundNetwork, refreshKey }: {
  visible: boolean; refreshSeconds: number; publicIpEnabled: boolean; publicIpMinutes: number; backgroundNetwork: boolean; refreshKey: number;
}) {
  const [systemStats, setSystemStats] = useState<SystemStatsResult | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStatsResult | null>(null);
  const [networkStats, setNetworkStats] = useState<NetworkStatsResult | null>(null);
  const [publicIp, setPublicIp] = useState<PublicIpResult | null>(null);
  const [topProcesses, setTopProcesses] = useState<TopProcessesResult | null>(null);
  // Rolling recent-samples window for the utilization sparklines — a
  // frontend-only trend view (doesn't survive a restart, same as Activity
  // Monitor's own history), fed by the system/storage polls below.
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [storageHistory, setStorageHistory] = useState<number[]>([]);
  const loadSystemStats = useCallback(async () => {
    setSystemStats(await window.api.stats.system());
  }, []);
  const loadStorageStats = useCallback(async () => {
    setStorageStats(await window.api.stats.storage());
  }, []);
  const loadNetworkStats = useCallback(async () => {
    setNetworkStats(await window.api.stats.network());
  }, []);
  const loadTopProcesses = useCallback(async () => {
    setTopProcesses(await window.api.stats.topProcesses());
  }, []);
  // Deliberately not part of refreshAll's Promise.all, same reasoning as
  // loadDockerUpdates — this is the one call to a third party, so it only
  // runs from its own interval and the widget's manual "check now" button.
  const loadPublicIp = useCallback(async () => {
    setPublicIp(await window.api.stats.publicIp());
  }, []);
  // ---- Utilization sparkline history: append the latest sample whenever
  // system/storage stats resolve, regardless of what triggered the fetch
  // (interval, refreshAll, or the initial boot load). ----
  useEffect(() => {
    if (!systemStats?.ok) return;
    setCpuHistory((prev) => [...prev, systemStats.cpuPercent].slice(-STATS_HISTORY_LENGTH));
    const memPercent = (systemStats.memory.usedBytes / systemStats.memory.totalBytes) * 100;
    setMemHistory((prev) => [...prev, memPercent].slice(-STATS_HISTORY_LENGTH));
  }, [systemStats]);

  useEffect(() => {
    if (!storageStats?.ok) return;
    const main = storageStats.volumes[0];
    if (!main) return;
    setStorageHistory((prev) => [...prev, main.usedPercent].slice(-STATS_HISTORY_LENGTH));
  }, [storageStats]);


  usePolling(async () => { await Promise.all([loadSystemStats(), loadTopProcesses()]); }, Math.max(1, refreshSeconds) * 1000, visible, 0, refreshKey);
  usePolling(loadStorageStats, 60_000, visible, 0, refreshKey);
  usePolling(loadNetworkStats, Math.max(1, refreshSeconds) * 1000, visible || backgroundNetwork, 0, refreshKey);
  usePolling(loadPublicIp, Math.max(1, publicIpMinutes) * 60_000, visible && publicIpEnabled);
  return <>      {visible && (
        <main className="grid grid-stats">
          <div className="slot slot-cpu-graph">
            <UtilizationWidget
              title="CPU"
              percent={systemStats?.ok ? systemStats.cpuPercent : null}
              history={cpuHistory}
              ok={systemStats === null || systemStats.ok}
              reason={systemStats && !systemStats.ok ? systemStats.reason : undefined}
            />
          </div>
          <div className="slot slot-mem-graph">
            <UtilizationWidget
              title="Memory"
              percent={
                systemStats?.ok
                  ? (systemStats.memory.usedBytes / systemStats.memory.totalBytes) * 100
                  : null
              }
              history={memHistory}
              ok={systemStats === null || systemStats.ok}
              reason={systemStats && !systemStats.ok ? systemStats.reason : undefined}
            />
          </div>
          <div className="slot slot-storage-graph">
            <UtilizationWidget
              title="Storage"
              percent={storageStats?.ok ? (storageStats.volumes[0]?.usedPercent ?? null) : null}
              history={storageHistory}
              ok={storageStats === null || storageStats.ok}
              reason={storageStats && !storageStats.ok ? storageStats.reason : undefined}
            />
          </div>
          <div className="slot slot-system-stats">
            <SystemStatsWidget data={systemStats} />
          </div>
          <div className="slot slot-storage-stats">
            <StorageWidget data={storageStats} />
          </div>
          <div className="slot slot-network-stats">
            <NetworkWidget
              data={networkStats}
              publicIp={publicIp}
              publicIpEnabled={publicIpEnabled}
              onCheckPublicIpNow={loadPublicIp}
            />
          </div>
          <div className="slot slot-top-processes">
            <TopProcessesWidget data={topProcesses} />
          </div>
        </main>
      )}
</>;
}
