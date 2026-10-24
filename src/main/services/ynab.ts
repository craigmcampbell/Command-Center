// YNAB REST API (https://api.ynab.com/v1): account balances, unapproved
// transactions, and this month's scheduled transactions. Fails soft, like the
// other services — every exported function returns { ok, reason?, ... }
// rather than throwing.

import type {
  YnabAccountsResult,
  YnabCategoriesResult,
  YnabMonthResult,
  YnabNewTransactionInput,
  YnabPayeesResult,
  YnabScalarConfig,
  YnabScheduledResult,
  YnabUnapprovedResult,
} from "../../shared/types";
import type {
  ActionResult,
  YnabBulkApproveResult,
  YnabImportResult,
  YnabSplitPart,
} from "../../shared/types";
import { API_ROOT, fetchDelta, ynabErrorReason, ynabFetch } from "./ynabDelta";

function milliunitsToDollars(n: number): number {
  return n / 1000;
}

export async function getAccounts(config: YnabScalarConfig): Promise<YnabAccountsResult> {
  const res = await fetchDelta(config, "accounts", "accounts");
  if (!res.ok) return { ok: false, reason: res.reason, accounts: [] };

  const hiddenIds = new Set(config.hiddenAccountIds ?? []);
  const accounts = res.items
    .filter((a: any) => !a.closed)
    .map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: milliunitsToDollars(a.balance),
      hidden: hiddenIds.has(a.id),
    }));

  return { ok: true, accounts };
}

// Deliberately not a delta request: `type=unapproved` is a server-side filter,
// and a delta against a filter never reports a row that left it — an approved
// transaction would stay in the cached list forever. See ynabDelta.ts.
export async function getUnapprovedTransactions(
  config: YnabScalarConfig
): Promise<YnabUnapprovedResult> {
  const { token, planId } = config;
  if (!token || !planId) {
    return { ok: false, reason: "No YNAB token configured", transactions: [] };
  }

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/transactions?type=unapproved`, token);
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB", transactions: [] };
  }
  if (!res.ok) {
    return { ok: false, reason: await ynabErrorReason(res), transactions: [] };
  }

  const data = await res.json();
  const transactions = (data.data?.transactions ?? []).map((t: any) => ({
    id: t.id,
    date: t.date,
    amount: milliunitsToDollars(t.amount),
    payeeName: t.payee_name ?? null,
    accountId: t.account_id,
    accountName: t.account_name,
    categoryId: t.category_id ?? null,
    categoryName: t.category_name ?? null,
    memo: t.memo ?? null,
    isSplit: Array.isArray(t.subtransactions) && t.subtransactions.length > 0,
    ynabUrl: `https://app.ynab.com/${planId}/accounts/${t.account_id}`,
  }));

  return { ok: true, transactions };
}

function isInCurrentMonth(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}

export async function getScheduledTransactionsThisMonth(
  config: YnabScalarConfig
): Promise<YnabScheduledResult> {
  const res = await fetchDelta(config, "scheduled_transactions", "scheduled_transactions");
  if (!res.ok) return { ok: false, reason: res.reason, transactions: [] };

  const transactions = res.items
    .filter((t: any) => isInCurrentMonth(t.date_next))
    .map((t: any) => ({
      id: t.id,
      dateNext: t.date_next,
      frequency: t.frequency,
      amount: milliunitsToDollars(t.amount),
      payeeName: t.payee_name ?? null,
      accountId: t.account_id,
      accountName: t.account_name,
      memo: t.memo ?? null,
    }));

  return { ok: true, transactions };
}

// Shared by approve/category/memo — all three are a single-field partial
// update against the same bulk PATCH endpoint.
async function patchTransactionField(
  config: YnabScalarConfig,
  transactionId: string,
  fields: Record<string, unknown>
): Promise<ActionResult> {
  const { token, planId } = config;
  if (!token || !planId) return { ok: false, reason: "No YNAB token configured" };

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/transactions`, token, {
      method: "PATCH",
      body: JSON.stringify({ transactions: [{ id: transactionId, ...fields }] }),
    });
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB" };
  }
  if (!res.ok) {
    return { ok: false, reason: await ynabErrorReason(res) };
  }

  return { ok: true };
}

export function approveTransaction(
  config: YnabScalarConfig,
  transactionId: string
): Promise<ActionResult> {
  return patchTransactionField(config, transactionId, { approved: true });
}

export function clearTransaction(
  config: YnabScalarConfig,
  transactionId: string
): Promise<ActionResult> {
  return patchTransactionField(config, transactionId, { cleared: "cleared" });
}

export function setTransactionCategory(
  config: YnabScalarConfig,
  transactionId: string,
  categoryId: string
): Promise<ActionResult> {
  return patchTransactionField(config, transactionId, { category_id: categoryId });
}

export function setTransactionMemo(
  config: YnabScalarConfig,
  transactionId: string,
  memo: string
): Promise<ActionResult> {
  return patchTransactionField(config, transactionId, { memo });
}

export async function createTransaction(
  config: YnabScalarConfig,
  input: YnabNewTransactionInput
): Promise<ActionResult> {
  const { token, planId } = config;
  if (!token || !planId) return { ok: false, reason: "No YNAB token configured" };

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/transactions`, token, {
      method: "POST",
      body: JSON.stringify({
        transaction: {
          account_id: input.accountId,
          date: input.date,
          amount: Math.round(input.amount * 1000),
          // payee_id and payee_name are alternatives, not both-at-once — a
          // picked payee wins; a typed name with no id lets YNAB mint a new
          // payee the way it always has.
          payee_id: input.payeeId || undefined,
          payee_name: input.payeeId ? undefined : input.payeeName || undefined,
          category_id: input.categoryId || undefined,
          memo: input.memo || undefined,
        },
      }),
    });
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB" };
  }
  if (!res.ok) {
    return { ok: false, reason: await ynabErrorReason(res) };
  }

  return { ok: true };
}

// Asks YNAB to pull whatever its linked banks have waiting (Direct Import) —
// the same thing as the Import button in the app. Imported rows arrive
// unapproved, so the caller refreshes the unapproved list afterwards.
export async function importTransactions(config: YnabScalarConfig): Promise<YnabImportResult> {
  const { token, planId } = config;
  if (!token || !planId) return { ok: false, reason: "No YNAB token configured", imported: 0 };

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/transactions/import`, token, {
      method: "POST",
    });
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB", imported: 0 };
  }
  if (!res.ok) return { ok: false, reason: await ynabErrorReason(res), imported: 0 };

  const body = await res.json().catch(() => null);
  const ids = body?.data?.transaction_ids;
  return { ok: true, imported: Array.isArray(ids) ? ids.length : 0 };
}

// Approving is one PATCH for the whole batch rather than one per row, in chunks
// so a very long backlog doesn't ride on a single request body. A chunk that
// fails stops the run: `approved` then says how far it got, and the rest are
// still unapproved rather than in some unknown state.
const APPROVE_CHUNK = 100;

export async function approveTransactions(
  config: YnabScalarConfig,
  transactionIds: string[]
): Promise<YnabBulkApproveResult> {
  const { token, planId } = config;
  if (!token || !planId) return { ok: false, reason: "No YNAB token configured", approved: 0 };

  const ids = Array.from(new Set(transactionIds));
  let approved = 0;
  for (let i = 0; i < ids.length; i += APPROVE_CHUNK) {
    const chunk = ids.slice(i, i + APPROVE_CHUNK);
    let res: Response;
    try {
      res = await ynabFetch(`${API_ROOT}/plans/${planId}/transactions`, token, {
        method: "PATCH",
        body: JSON.stringify({ transactions: chunk.map((id) => ({ id, approved: true })) }),
      });
    } catch {
      return { ok: false, reason: "Couldn't reach YNAB", approved };
    }
    if (!res.ok) return { ok: false, reason: await ynabErrorReason(res), approved };
    approved += chunk.length;
  }
  return { ok: true, approved };
}

// Turns an existing, not-yet-split transaction into a split. The parts are
// checked against YNAB's own copy of the transaction — its real amount and
// sign, and whether it's already a split — not whatever the renderer last
// showed, so a stale row can't produce a split that doesn't add up. YNAB does
// not support editing the lines of a transaction that is already a split.
export async function splitTransaction(
  config: YnabScalarConfig,
  transactionId: string,
  parts: YnabSplitPart[]
): Promise<ActionResult> {
  const { token, planId } = config;
  if (!token || !planId) return { ok: false, reason: "No YNAB token configured" };
  if (parts.length < 2) return { ok: false, reason: "A split needs at least two lines" };
  if (parts.some((p) => !p.categoryId)) return { ok: false, reason: "Every line needs a category" };

  let current: Response;
  try {
    current = await ynabFetch(
      `${API_ROOT}/plans/${planId}/transactions/${encodeURIComponent(transactionId)}`,
      token
    );
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB" };
  }
  if (!current.ok) return { ok: false, reason: await ynabErrorReason(current) };

  const t = (await current.json().catch(() => null))?.data?.transaction;
  if (!t) return { ok: false, reason: "YNAB didn't return that transaction" };
  if (Array.isArray(t.subtransactions) && t.subtransactions.length > 0) {
    return { ok: false, reason: "That transaction is already split — edit it in YNAB" };
  }

  const sign = t.amount < 0 ? -1 : 1;
  const lines = parts.map((p) => ({
    amount: sign * Math.round(Math.abs(p.amount) * 1000),
    category_id: p.categoryId,
    memo: p.memo || undefined,
  }));
  if (lines.some((l) => l.amount === 0)) return { ok: false, reason: "Every line needs an amount" };
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total !== t.amount) {
    return {
      ok: false,
      reason: `The lines add up to ${(total / 1000).toFixed(2)} but the transaction is ${(t.amount / 1000).toFixed(2)}`,
    };
  }

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/transactions`, token, {
      method: "PATCH",
      body: JSON.stringify({
        transactions: [{ id: transactionId, category_id: null, subtransactions: lines }],
      }),
    });
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB" };
  }
  if (!res.ok) return { ok: false, reason: await ynabErrorReason(res) };
  return { ok: true };
}

// Flattens category_groups into a single assignable list — internal groups
// (Uncategorized, Inflow: Ready to Assign) and anything hidden/deleted are
// dropped, since those aren't real choices for categorizing a transaction.
// Categories keep the API's own group order and are sorted by name within
// each group.
export async function getCategories(config: YnabScalarConfig): Promise<YnabCategoriesResult> {
  const { token, planId } = config;
  if (!token || !planId) {
    return { ok: false, reason: "No YNAB token configured", categories: [] };
  }

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/categories`, token);
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB", categories: [] };
  }
  if (!res.ok) {
    return { ok: false, reason: await ynabErrorReason(res), categories: [] };
  }

  const data = await res.json();
  const categories = (data.data?.category_groups ?? [])
    .filter((g: any) => !g.hidden && !g.deleted)
    .flatMap((g: any) =>
      (g.categories ?? [])
        .filter((c: any) => !c.hidden && !c.deleted && !c.internal)
        .slice()
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
        .map((c: any) => ({ id: c.id, name: c.name, groupName: g.name }))
    );

  return { ok: true, categories };
}

// Deleted payees and transfer payees (moves between the budget's own
// accounts, named like "Transfer : Checking") are dropped — neither is a
// meaningful thing to autocomplete into a transaction's payee field.
export async function getPayees(config: YnabScalarConfig): Promise<YnabPayeesResult> {
  const res = await fetchDelta(config, "payees", "payees");
  if (!res.ok) return { ok: false, reason: res.reason, payees: [] };

  const payees = res.items
    .filter((p: any) => !p.deleted && !p.transfer_account_id)
    .map((p: any) => ({ id: p.id, name: p.name }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  return { ok: true, payees };
}

// Budget-month totals plus per-category budgeted/activity/balance for the
// current calendar month. Reuses getCategories as the allowlist of
// assignable category ids rather than re-deriving the hidden/deleted/
// internal filter a second time — /months/current's categories[] is flat,
// unlike /categories' grouped shape, so this maps category_group_name
// straight across instead of nesting.
export async function getCurrentMonth(config: YnabScalarConfig): Promise<YnabMonthResult> {
  const { token, planId } = config;
  if (!token || !planId) {
    return { ok: false, reason: "No YNAB token configured", toBeBudgeted: 0, ageOfMoney: null, categories: [] };
  }

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/months/current`, token);
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB", toBeBudgeted: 0, ageOfMoney: null, categories: [] };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: await ynabErrorReason(res),
      toBeBudgeted: 0,
      ageOfMoney: null,
      categories: [],
    };
  }

  const allowed = await getCategories(config);
  const allowedIds = new Set(allowed.ok ? allowed.categories.map((c) => c.id) : []);

  const data = await res.json();
  const month = data.data?.month ?? {};
  // Belt and suspenders: allowedIds already excludes hidden/deleted/internal
  // (getCategories filters at the group level too, which this endpoint's
  // flat category list doesn't expose), and the month category's own
  // hidden/deleted/internal fields are checked directly as well so a
  // category can't leak through via either path alone.
  const categories = (month.categories ?? [])
    .filter((c: any) => allowedIds.has(c.id) && !c.hidden && !c.deleted && !c.internal)
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      groupName: c.category_group_name,
      budgeted: milliunitsToDollars(c.budgeted),
      activity: milliunitsToDollars(c.activity),
      balance: milliunitsToDollars(c.balance),
    }));

  return {
    ok: true,
    toBeBudgeted: milliunitsToDollars(month.to_be_budgeted ?? 0),
    ageOfMoney: month.age_of_money ?? null,
    categories,
  };
}
