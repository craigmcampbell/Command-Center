// What the Assistant has spent per local day, for the daily spending cap. One
// row per day, added to as each model request reports its usage — replies,
// titles, summaries and memory tidies alike, and whether or not the turn they
// belonged to succeeded. A chat's own `cost_usd` can't answer "today": it is a
// running total, and a failed turn never reaches it.
//
// A request whose provider reported no cost is counted in `unpriced` instead of
// as $0, so the cap can say it couldn't see that spend rather than look clean.

import type { AssistantSpendToday, AssistantUsage } from "../../shared/types";
import { localDate } from "./assistantMemory";
import { getDatabase } from "./db";

export function initAssistantSpend(): void {
  getDatabase().exec(`CREATE TABLE IF NOT EXISTS assistant_spend (
    day TEXT PRIMARY KEY,
    cost_usd REAL NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0,
    unpriced INTEGER NOT NULL DEFAULT 0
  )`);
}

// Never throws: losing a ledger row must not fail the reply that paid for it.
export function recordSpend(usage: AssistantUsage | undefined, day = localDate()): void {
  if (!usage) return;
  try {
    getDatabase()
      .prepare(
        `INSERT INTO assistant_spend (day, cost_usd, requests, unpriced) VALUES (@day, @cost, 1, @unpriced)
         ON CONFLICT(day) DO UPDATE SET
           cost_usd = cost_usd + @cost,
           requests = requests + 1,
           unpriced = unpriced + @unpriced`
      )
      .run({ day, cost: usage.costUsd ?? 0, unpriced: usage.costUsd === null ? 1 : 0 });
  } catch (error) {
    console.error("Couldn't record assistant spend", error);
  }
}

export function spendToday(day = localDate()): AssistantSpendToday {
  try {
    const row = getDatabase()
      .prepare(`SELECT cost_usd, requests, unpriced FROM assistant_spend WHERE day = ?`)
      .get(day) as { cost_usd: number; requests: number; unpriced: number } | undefined;
    return { costUsd: row?.cost_usd ?? 0, requests: row?.requests ?? 0, unpriced: row?.unpriced ?? 0 };
  } catch {
    return { costUsd: 0, requests: 0, unpriced: 0 };
  }
}
