import { startPolling } from "../lib/polling";
import { useEffect, useRef, useState } from "react";

export function useWindowVisible(): boolean {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  return visible;
}

// Schedule after completion, never on a fixed interval that can accumulate work.
// Ref keeps the current callback without restarting a timer on every render.
export function usePolling(load: () => Promise<unknown>, milliseconds: number, enabled = true, initialDelay = 0, identity: unknown = null): void {
  const latest = useRef(load);
  latest.current = load;
  const inFlight = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    if (!enabled || milliseconds <= 0) return;
    return startPolling(() => latest.current(), milliseconds, initialDelay, inFlight);
  }, [milliseconds, enabled, initialDelay, identity]);
}
