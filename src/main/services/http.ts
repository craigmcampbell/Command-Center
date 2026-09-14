// Explicit deadlines include response body reads. Backoff is per origin and only
// applies to GETs; writes are never silently replayed or suppressed.
const failures = new Map<string, { count: number; until: number }>();
export async function fetchWithTimeout(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const origin = new URL(input).origin;
  const read = !init.method || init.method === "GET";
  const previous = failures.get(origin);
  if (read && previous && previous.until > Date.now()) throw new Error("Service temporarily unavailable; retrying shortly");
  try {
    const deadline = AbortSignal.timeout(20_000);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    const response = await fetch(input, { ...init, signal });
    if (read && (response.status === 429 || response.status >= 500)) {
      const count = Math.min((failures.get(origin)?.count ?? 0) + 1, 6);
      const retry = response.headers.get("retry-after");
      const seconds = retry ? Number(retry) : NaN;
      const retryMs = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      failures.set(origin, { count, until: Date.now() + Math.min(300_000, Math.max(5000 * 2 ** (count - 1), retryMs || 0)) });
    } else if (response.ok && failures.get(origin) === previous) failures.delete(origin);
    return response;
  } catch (error) {
    if (read) {
      const count = Math.min((failures.get(origin)?.count ?? 0) + 1, 6);
      failures.set(origin, { count, until: Date.now() + 5000 * 2 ** (count - 1) });
    }
    throw error;
  }
}
