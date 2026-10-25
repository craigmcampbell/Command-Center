// Adding up and describing Assistant token usage. Shared because main keeps the
// per-chat totals and the renderer keeps a live copy while a reply runs; both
// must sum the same way.

import type { AssistantUsage } from "./types";

// An absent count stays absent only while both sides lack it, so one reply that
// reported cache figures makes the total start reporting them.
function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

export function sumUsage(total: AssistantUsage, step: AssistantUsage | undefined): AssistantUsage {
  if (!step) return total;
  const cachedTokens = sumOptional(total.cachedTokens, step.cachedTokens);
  const cacheWriteTokens = sumOptional(total.cacheWriteTokens, step.cacheWriteTokens);
  return {
    promptTokens: total.promptTokens + step.promptTokens,
    completionTokens: total.completionTokens + step.completionTokens,
    costUsd: step.costUsd === null ? total.costUsd : (total.costUsd ?? 0) + step.costUsd,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
  };
}

// Share of the prompt tokens that were read from cache, 0-1, or null when there
// is nothing to say: no prompt tokens, or no cache figures ever reported.
export function cachedShare(usage: AssistantUsage): number | null {
  if (!usage.promptTokens || usage.cachedTokens === undefined) return null;
  return Math.min(1, usage.cachedTokens / usage.promptTokens);
}
