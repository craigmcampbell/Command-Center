// YNAB REST API (https://api.ynab.com/v1): account balances, unapproved
// transactions, and this month's scheduled transactions. Fails soft, like the
// other services — every exported function returns { ok, reason?, ... }
// rather than throwing.

import type {
  YnabAccountsResult,
  YnabCategoriesResult,
  YnabNewTransactionInput,
  YnabScalarConfig,
  YnabScheduledResult,
  YnabUnapprovedResult,
} from "../../shared/types";
import type { ActionResult } from "../../shared/types";

const API_ROOT = "https://api.ynab.com/v1";

function ynabFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

// YNAB reports errors as a JSON body ({ error: { id, name, detail } }) rather
// than distinct headers, so this has to read the response body, unlike
// github.ts's header-only rate-limit check.
async function ynabErrorReason(res: Response): Promise<string> {
  if (res.status === 401) return "YNAB token rejected";
  if (res.status === 429) return "Rate limited, try again later";
  try {
    const body = await res.json();
    if (body?.error?.detail) return body.error.detail;
  } catch {
    // fall through to the generic message below
  }
  return `YNAB request failed (${res.status})`;
}

function milliunitsToDollars(n: number): number {
  return n / 1000;
}

export async function getAccounts(config: YnabScalarConfig): Promise<YnabAccountsResult> {
  const { token, planId } = config;
  if (!token || !planId) {
    return { ok: false, reason: "No YNAB token configured", accounts: [] };
  }

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/accounts`, token);
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB", accounts: [] };
  }
  if (!res.ok) {
    return { ok: false, reason: await ynabErrorReason(res), accounts: [] };
  }

  const hiddenIds = new Set(config.hiddenAccountIds ?? []);
  const data = await res.json();
  const accounts = (data.data?.accounts ?? [])
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
  const { token, planId } = config;
  if (!token || !planId) {
    return { ok: false, reason: "No YNAB token configured", transactions: [] };
  }

  let res: Response;
  try {
    res = await ynabFetch(`${API_ROOT}/plans/${planId}/scheduled_transactions`, token);
  } catch {
    return { ok: false, reason: "Couldn't reach YNAB", transactions: [] };
  }
  if (!res.ok) {
    return { ok: false, reason: await ynabErrorReason(res), transactions: [] };
  }

  const data = await res.json();
  const transactions = (data.data?.scheduled_transactions ?? [])
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
          payee_name: input.payeeName || undefined,
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
