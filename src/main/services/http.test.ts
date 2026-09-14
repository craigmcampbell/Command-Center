import { afterEach, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./http";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("applies a deadline and respects rate-limit backoff without suppressing writes", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '30' } })).mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await fetchWithTimeout('https://rate-limit.test/read');
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  await expect(fetchWithTimeout('https://rate-limit.test/read')).rejects.toThrow('retrying');
  expect(fetch).toHaveBeenCalledTimes(1);
  await fetchWithTimeout('https://rate-limit.test/write', { method: 'POST' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
