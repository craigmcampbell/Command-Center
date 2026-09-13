// Formatting helpers for the Stats tab widgets (System/Storage/Network).
// Kept separate from lib/time.ts, which is scoped to Todoist timers/billing.

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

// Bytes/sec -> a human throughput string, e.g. "1.4 MB/s".
export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

// e.g. 847639 -> "9d 19h", 3600 -> "1h 0m", 90 -> "1m".
export function formatUptime(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
