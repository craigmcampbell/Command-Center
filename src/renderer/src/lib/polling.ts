export interface PollRequest { current: Promise<unknown> | null }

export function startPolling(load: () => Promise<unknown>, milliseconds: number, initialDelay = 0, shared: PollRequest = { current: null }): () => void {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout>;
  async function tick() {
    let request: Promise<unknown> | null = null;
    try {
      if (shared.current) await shared.current.catch(() => undefined);
      if (stopped) return;
      request = Promise.resolve().then(load);
      shared.current = request;
      const result = await request;
      failures = result && typeof result === "object" && "ok" in result && result.ok === false ? Math.min(failures + 1, 4) : 0;
    } catch {
      failures = Math.min(failures + 1, 4);
    } finally {
      if (shared.current === request) shared.current = null;
      if (!stopped) timer = setTimeout(tick, milliseconds * 2 ** failures);
    }
  }
  timer = setTimeout(tick, initialDelay);
  return () => { stopped = true; clearTimeout(timer); };
}
