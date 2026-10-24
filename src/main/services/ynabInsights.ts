// Read-only history views over YNAB for the Finances tab: spending trends,
// net worth over time, and budget money movements. None of it is stored — every
// figure is derived from what YNAB already holds, and the delta cache in
// ynabDelta.ts keeps the repeat cost down. Fails soft like ynab.ts.

import type {
  YnabAccountHistoryResult,
  YnabCategoryTrend,
  YnabMoneyMovementsResult,
  YnabNetWorthResult,
  YnabScalarConfig,
  YnabTrendsResult,
} from "../../shared/types";
import { getCategories } from "./ynab";
import { API_ROOT, fetchDelta, ynabErrorReason, ynabFetch } from "./ynabDelta";

const toDollars = (milli: number) => milli / 1000;

// YNAB's own "current" month is the UTC calendar month, so this follows it
// rather than local time — the two disagree for a few hours at month end.
export function currentMonthStart(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function addMonths(monthStart: string, delta: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// "Credit Card Payments" is a group YNAB creates itself. Its categories move
// money toward a card when you spend on it, so their activity is a payment, not
// spending — counting it would count every card purchase twice.
const CREDIT_CARD_GROUP = "Credit Card Payments";

interface MonthDetail {
  fetchedAt: number;
  fingerprint: string;
  categories: any[];
}

// Past months rarely change, so their per-category detail is kept for a while
// instead of refetched on every poll. The fingerprint (from the delta-cached
// month list) catches an edit to a past month early; the age limit catches the
// one it can't — money moved between two categories leaves every total alone.
const DETAIL_MAX_AGE_MS = 30 * 60_000;
const details = new Map<string, MonthDetail>();

export function resetYnabInsightsCache(): void {
  details.clear();
}

async function monthDetail(
  config: YnabScalarConfig,
  summary: any,
  isCurrent: boolean
): Promise<{ ok: true; categories: any[] } | { ok: false; reason: string }> {
  const { token, planId } = config;
  const key = `${token}|${planId}|${summary.month}`;
  const fingerprint = `${summary.budgeted}|${summary.activity}|${summary.to_be_budgeted}`;
  const hit = details.get(key);
  if (
    hit &&
    !isCurrent &&
    hit.fingerprint === fingerprint &&
    Date.now() - hit.fetchedAt < DETAIL_MAX_AGE_MS
  ) {
    return { ok: true, categories: hit.categories };
  }

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/months/${summary.month}`, token!);
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB" };
  }
  if (!res.ok) return { ok: false, reason: await ynabErrorReason(res) };

  const categories = (await res.json().catch(() => null))?.data?.month?.categories ?? [];
  details.set(key, { fetchedAt: Date.now(), fingerprint, categories });
  return { ok: true, categories };
}

export async function getSpendingTrends(
  config: YnabScalarConfig,
  count = 6
): Promise<YnabTrendsResult> {
  const fail = (reason: string): YnabTrendsResult => ({ ok: false, reason, months: [], categories: [] });

  const list = await fetchDelta(config, "months", "months", { idField: "month" });
  if (!list.ok) return fail(list.reason);
  const allowed = await getCategories(config);
  if (!allowed.ok) return fail(allowed.reason ?? "Couldn't load categories");
  const allowedById = new Map(allowed.categories.map((c) => [c.id, c]));

  const current = currentMonthStart();
  const window = list.items
    .filter((m: any) => m.month <= current)
    .sort((a: any, b: any) => a.month.localeCompare(b.month))
    .slice(-count);
  if (window.length === 0) return { ok: true, months: [], categories: [] };

  const fetched = await Promise.all(window.map((m: any) => monthDetail(config, m, m.month === current)));
  const failed = fetched.find((f) => !f.ok);
  if (failed && !failed.ok) return fail(failed.reason);

  const series = new Map<string, YnabCategoryTrend>();
  const months = window.map((summary: any, i: number) => {
    const cats = (fetched[i] as { ok: true; categories: any[] }).categories;
    let spent = 0;
    let budgeted = 0;
    for (const c of cats) {
      const known = allowedById.get(c.id);
      if (!known || known.groupName === CREDIT_CARD_GROUP) continue;
      // Refunds make activity positive; that counts as nothing spent rather
      // than a negative bar, the same call BudgetHealthWidget makes.
      const catSpent = Math.max(0, -toDollars(c.activity));
      const catBudgeted = toDollars(c.budgeted);
      spent += catSpent;
      budgeted += catBudgeted;

      let row = series.get(c.id);
      if (!row) {
        row = {
          id: c.id,
          name: known.name,
          groupName: known.groupName,
          spent: new Array(window.length).fill(0),
          budgeted: new Array(window.length).fill(0),
        };
        series.set(c.id, row);
      }
      row.spent[i] = catSpent;
      row.budgeted[i] = catBudgeted;
    }
    return {
      month: summary.month as string,
      income: toDollars(summary.income ?? 0),
      budgeted,
      spent,
      ageOfMoney: summary.age_of_money ?? null,
    };
  });

  const total = (c: YnabCategoryTrend) => c.spent.reduce((a, b) => a + b, 0);
  const categories = Array.from(series.values())
    .filter((c) => total(c) > 0 || c.budgeted.some((b) => b > 0))
    .sort((a, b) => total(b) - total(a));

  return { ok: true, months, categories };
}

// YNAB keeps no balance history, so past balances are worked backwards from
// today's: the balance at the end of a month is the current balance minus
// everything dated after that month. That needs no stored snapshots and is
// correct from the first poll rather than only from when the app started
// recording. Assumes an account's balance includes future-dated transactions,
// which is how YNAB reports it; both sides of the subtraction use the same set
// either way.
//
// Net worth and per-account history share one transaction fetch (same
// `since_date`, so one delta-cache entry): everything dated after the earliest
// point's month, bucketed by account and month.
async function loadMonthlyChanges(
  config: YnabScalarConfig,
  count: number
): Promise<{ ok: true; byAccount: Map<string, Map<string, number>> } | { ok: false; reason: string }> {
  // The earliest point needs everything dated after *its* month ends.
  const since = addMonths(currentMonthStart(), -(count - 2));
  const txns = await fetchDelta(config, "transactions", "transactions", {
    query: { since_date: since },
  });
  if (!txns.ok) return txns;

  const byAccount = new Map<string, Map<string, number>>();
  for (const t of txns.items) {
    const month = `${String(t.date).slice(0, 7)}-01`;
    const months = byAccount.get(t.account_id) ?? new Map<string, number>();
    months.set(month, (months.get(month) ?? 0) + t.amount);
    byAccount.set(t.account_id, months);
  }
  return { ok: true, byAccount };
}

// Balance as of the end of `month`, in milliunits.
function balanceAt(current: number, changes: Map<string, number> | undefined, month: string): number {
  let after = 0;
  for (const [m, sum] of changes ?? []) if (m > month) after += sum;
  return current - after;
}

// Two choices worth knowing for net worth:
//   - Closed accounts are kept. Their balance is ~0 now, so they add nothing,
//     but a transfer that emptied one into an open account needs both legs or
//     the history shows a phantom jump.
//   - Hidden accounts (hidden in the Accounts widget) are left out, so this is
//     the net worth of what the dashboard shows.
export async function getNetWorthHistory(
  config: YnabScalarConfig,
  count = 12
): Promise<YnabNetWorthResult> {
  const fail = (reason: string): YnabNetWorthResult => ({ ok: false, reason, current: 0, points: [] });

  const accounts = await fetchDelta(config, "accounts", "accounts");
  if (!accounts.ok) return fail(accounts.reason);
  const hidden = new Set(config.hiddenAccountIds ?? []);
  const included = accounts.items.filter((a: any) => !hidden.has(a.id));

  const changes = await loadMonthlyChanges(config, count);
  if (!changes.ok) return fail(changes.reason);

  const thisMonth = currentMonthStart();
  const points = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = addMonths(thisMonth, -i);
    const total = included.reduce(
      (sum: number, a: any) => sum + balanceAt(a.balance, changes.byAccount.get(a.id), month),
      0
    );
    points.push({ month, netWorth: toDollars(total) });
  }

  const current = included.reduce((sum: number, a: any) => sum + a.balance, 0);
  return { ok: true, current: toDollars(current), points };
}

// Month-end balances for specific accounts, for the credit-card utilization
// trend. The last entry is today's live balance rather than "end of this
// month", so it matches what the Cards tab shows right now.
export async function getAccountBalanceHistory(
  config: YnabScalarConfig,
  accountIds: string[],
  count = 12
): Promise<YnabAccountHistoryResult> {
  const fail = (reason: string): YnabAccountHistoryResult => ({ ok: false, reason, months: [], balances: {} });
  if (accountIds.length === 0) return { ok: true, months: [], balances: {} };

  const accounts = await fetchDelta(config, "accounts", "accounts");
  if (!accounts.ok) return fail(accounts.reason);
  const changes = await loadMonthlyChanges(config, count);
  if (!changes.ok) return fail(changes.reason);

  const thisMonth = currentMonthStart();
  const months = Array.from({ length: count }, (_, i) => addMonths(thisMonth, -(count - 1 - i)));
  const balances: Record<string, number[]> = {};
  for (const id of accountIds) {
    const account = accounts.items.find((a: any) => a.id === id);
    if (!account) continue;
    balances[id] = months.map((month, i) =>
      toDollars(
        i === count - 1 ? account.balance : balanceAt(account.balance, changes.byAccount.get(id), month)
      )
    );
  }
  return { ok: true, months, balances };
}

const MOVEMENT_LIMIT = 100;

export async function getMoneyMovements(
  config: YnabScalarConfig
): Promise<YnabMoneyMovementsResult> {
  const fail = (reason: string): YnabMoneyMovementsResult => ({ ok: false, reason, movements: [] });

  const res = await fetchDelta(config, "money_movements", "money_movements");
  if (!res.ok) return fail(res.reason);
  const categories = await getCategories(config);
  const names = new Map(categories.ok ? categories.categories.map((c) => [c.id, c.name]) : []);

  // A null side is Ready to Assign. An id missing from the names is a category
  // since hidden or deleted, which getCategories deliberately leaves out.
  const label = (id: string | null) => (id ? names.get(id) ?? "Hidden category" : "Ready to Assign");
  const when = (m: any): string => m.moved_at ?? m.month ?? "";

  const movements = res.items
    .slice()
    .sort((a: any, b: any) => when(b).localeCompare(when(a)))
    .slice(0, MOVEMENT_LIMIT)
    .map((m: any) => ({
      id: m.id,
      date: m.moved_at ? String(m.moved_at).slice(0, 10) : null,
      month: m.month ?? null,
      fromName: label(m.from_category_id ?? null),
      toName: label(m.to_category_id ?? null),
      amount: toDollars(m.amount),
      note: m.note ?? null,
    }));

  return { ok: true, movements };
}
