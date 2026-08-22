// Anthropic API list prices, in USD per million tokens.
//
// These are NOT what you were billed. Claude Code on a Max/Pro subscription
// charges nothing per token; everything derived from this table is "what this
// usage would have cost at API rates". The UI has to say so.
//
// Transcripts record no cost field of their own, so this table is the only way
// to put a number on usage — which also means it goes stale silently when
// Anthropic changes prices or ships a model. `rateFor` returns null for
// anything unlisted so unknown models surface as *unpriced* rather than free.

export interface ModelRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

// Multipliers applied to a model's INPUT rate.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

const RATES: Record<string, ModelRate> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

// Introductory pricing that applies only up to a cutoff date. Rates have to be
// resolved from each message's OWN date, not today's: Sonnet 5's intro period
// covers essentially all existing history, and pricing it at standard rates
// overstates a real month's usage by around a quarter.
const INTRO_RATES: Record<string, { through: string; rate: ModelRate }> = {
  "claude-sonnet-5": { through: "2026-08-31", rate: { input: 2, output: 10 } },
};

/** `date` is a local "YYYY-MM-DD". Returns null for models we have no rate for. */
export function rateFor(model: string, date: string): ModelRate | null {
  const intro = INTRO_RATES[model];
  if (intro && date <= intro.through) return intro.rate;
  return RATES[model] ?? null;
}

// Subscription list prices, USD/month. Only used to express API-equivalent
// usage as a multiple of what the plan costs — a leverage figure, not a bill.
// Deliberately small and easy to audit: the widget prints the price it used,
// so a stale number is visible rather than silently skewing the ratio. An
// unrecognised plan simply gets no multiple.
const PLAN_PRICES: Record<string, { label: string; monthlyUsd: number }> = {
  claude_pro: { label: "Pro", monthlyUsd: 20 },
  claude_max_5x: { label: "Max 5×", monthlyUsd: 100 },
  claude_max_20x: { label: "Max 20×", monthlyUsd: 200 },
};

export function planFor(organizationType: string | undefined): {
  label: string;
  monthlyUsd?: number;
} | null {
  if (!organizationType) return null;
  const known = PLAN_PRICES[organizationType];
  if (known) return known;
  // Unknown plan: still name it, but don't invent a price for it.
  return { label: organizationType.replace(/^claude_/, "").replace(/_/g, " ") };
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export function costOf(tokens: TokenCounts, rate: ModelRate): number {
  const perInputToken = rate.input / 1_000_000;
  const perOutputToken = rate.output / 1_000_000;
  return (
    tokens.input * perInputToken +
    tokens.cacheRead * perInputToken * CACHE_READ_MULTIPLIER +
    tokens.cacheWrite5m * perInputToken * CACHE_WRITE_5M_MULTIPLIER +
    tokens.cacheWrite1h * perInputToken * CACHE_WRITE_1H_MULTIPLIER +
    tokens.output * perOutputToken
  );
}
