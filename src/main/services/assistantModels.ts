// Checks a model slug against OpenRouter's public model list when Settings
// saves it, so a typo or a model without tool calling is caught at the moment
// it is typed instead of as a 400 on the next question. Advisory only: a slug
// that isn't listed is still saved (the list can lag a new model), just with a
// warning. The list needs no key.

import type { AssistantModelCheck } from "../../shared/types";
import { fetchWithTimeout } from "./http";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
// The list is ~1MB and changes slowly; saving the card a few times in a row
// shouldn't refetch it.
const CACHE_MS = 10 * 60_000;

export interface ListedModel {
  id: string;
  context_length?: number;
  supported_parameters?: string[];
}

let cache: { at: number; models: ListedModel[] } | null = null;

export function resetModelListCache(): void {
  cache = null;
}

// Compaction exists to keep re-sent history cheap, not to fill the window, so
// the suggestion is well under it: 40% of the context (room for the reply,
// tools and system prompt), rounded down to a thousand, and never above 100k
// since every turn re-sends that much.
export function suggestCompactAt(contextLength: number): number {
  return Math.max(2000, Math.floor(Math.min(contextLength * 0.4, 100_000) / 1000) * 1000);
}

// Pure, so the rules can be tested without the network. OpenRouter variants
// (":free", ":nitro") share the base model's listing.
export function evaluateModel(models: ListedModel[], slug: string): AssistantModelCheck {
  const wanted = slug.trim();
  const listed = models.find((m) => m.id === wanted) ?? models.find((m) => m.id === wanted.replace(/:[a-z-]+$/, ""));
  if (!listed) return { ok: true, slug: wanted, known: false };
  const contextLength = Number.isFinite(listed.context_length) ? (listed.context_length as number) : undefined;
  return {
    ok: true,
    slug: wanted,
    known: true,
    tools: (listed.supported_parameters ?? []).includes("tools"),
    ...(contextLength ? { contextLength, suggestedCompactAt: suggestCompactAt(contextLength) } : {}),
  };
}

export async function checkAssistantModel(slug: unknown): Promise<AssistantModelCheck> {
  const wanted = typeof slug === "string" ? slug.trim() : "";
  if (!wanted) return { ok: false, slug: "", reason: "No model given" };
  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      const response = await fetchWithTimeout(MODELS_URL);
      if (!response.ok) return { ok: false, slug: wanted, reason: `OpenRouter error (${response.status})` };
      const body = (await response.json()) as { data?: ListedModel[] };
      if (!Array.isArray(body?.data)) return { ok: false, slug: wanted, reason: "Unexpected model list" };
      cache = { at: Date.now(), models: body.data };
    }
    return evaluateModel(cache.models, wanted);
  } catch {
    return { ok: false, slug: wanted, reason: "Couldn't reach OpenRouter to check the model" };
  }
}
