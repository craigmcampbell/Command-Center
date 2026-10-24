import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveTransactions,
  getAccounts,
  getUnapprovedTransactions,
  importTransactions,
  splitTransaction,
} from "./ynab";
import { resetYnabDeltaCache } from "./ynabDelta";
import { resetFetchBackoff } from "./http";
import {
  addMonths,
  currentMonthStart,
  getMoneyMovements,
  getAccountBalanceHistory,
  getNetWorthHistory,
  getSpendingTrends,
  resetYnabInsightsCache,
} from "./ynabInsights";

const CONFIG = { token: "tok", planId: "plan" };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status });

let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetYnabDeltaCache();
  resetYnabInsightsCache();
  resetFetchBackoff();
});
afterEach(() => vi.unstubAllGlobals());

describe("delta requests", () => {
  const acct = (id: string, balance: number, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    type: "checking",
    balance,
    closed: false,
    deleted: false,
    ...extra,
  });

  it("sends last_knowledge_of_server on the second call and merges the changes", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accounts: [acct("a", 1000), acct("b", 2000)], server_knowledge: 5 }))
      .mockResolvedValueOnce(
        json({ accounts: [acct("a", 1500), acct("b", 0, { deleted: true })], server_knowledge: 9 })
      );

    const first = await getAccounts(CONFIG);
    expect(first.accounts.map((a) => a.balance)).toEqual([1, 2]);

    const second = await getAccounts(CONFIG);
    expect(second.accounts).toEqual([
      { id: "a", name: "a", type: "checking", balance: 1.5, hidden: false },
    ]);

    const [firstCall, secondCall] = calls();
    expect(firstCall.url).not.toContain("last_knowledge_of_server");
    expect(secondCall.url).toContain("last_knowledge_of_server=5");
  });

  it("shares one request between concurrent callers", async () => {
    fetchMock.mockImplementation(async () => json({ accounts: [acct("a", 1000)], server_knowledge: 1 }));
    await Promise.all([getAccounts(CONFIG), getAccounts(CONFIG)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the cache when a refresh fails", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accounts: [acct("a", 1000)], server_knowledge: 1 }))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(json({ accounts: [], server_knowledge: 2 }));
    await getAccounts(CONFIG);
    expect((await getAccounts(CONFIG)).ok).toBe(false);
    resetFetchBackoff();
    const recovered = await getAccounts(CONFIG);
    // Resumed from knowledge 1, not restarted: the account is still there.
    expect(calls()[2].url).toContain("last_knowledge_of_server=1");
    expect(recovered.accounts).toHaveLength(1);
  });

  it("does not use a delta for the unapproved list", async () => {
    fetchMock.mockImplementation(async () => json({ transactions: [], server_knowledge: 1 }));
    await getUnapprovedTransactions(CONFIG);
    await getUnapprovedTransactions(CONFIG);
    expect(calls().every((c) => !c.url.includes("last_knowledge_of_server"))).toBe(true);
  });

  it("marks split transactions", async () => {
    fetchMock.mockResolvedValue(
      json({
        transactions: [
          { id: "t", date: "2026-10-01", amount: -1000, account_id: "a", account_name: "A", subtransactions: [{ id: "s" }] },
          { id: "u", date: "2026-10-01", amount: -1000, account_id: "a", account_name: "A", subtransactions: [] },
        ],
      })
    );
    const res = await getUnapprovedTransactions(CONFIG);
    expect(res.transactions.map((t) => t.isSplit)).toEqual([true, false]);
  });
});

describe("importTransactions", () => {
  it("POSTs to the import endpoint and counts what came back", async () => {
    fetchMock.mockResolvedValue(json({ transaction_ids: ["a", "b", "c"] }, 201));
    expect(await importTransactions(CONFIG)).toEqual({ ok: true, imported: 3 });
    expect(calls()[0].url).toBe("https://api.ynab.com/v1/plans/plan/transactions/import");
    expect(calls()[0].init.method).toBe("POST");
  });

  it("treats nothing new as success", async () => {
    fetchMock.mockResolvedValue(json({ transaction_ids: [] }));
    expect(await importTransactions(CONFIG)).toEqual({ ok: true, imported: 0 });
  });

  it("surfaces YNAB's own reason", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { detail: "No linked accounts" } }), { status: 400 })
    );
    expect(await importTransactions(CONFIG)).toEqual({ ok: false, reason: "No linked accounts", imported: 0 });
  });
});

describe("approveTransactions", () => {
  it("approves in one PATCH, de-duplicated", async () => {
    fetchMock.mockResolvedValue(json({}));
    expect(await approveTransactions(CONFIG, ["a", "b", "a"])).toEqual({ ok: true, approved: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(calls()[0].init.body))).toEqual({
      transactions: [
        { id: "a", approved: true },
        { id: "b", approved: true },
      ],
    });
  });

  it("chunks long lists and reports how far it got when one fails", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t${i}`);
    fetchMock
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { detail: "nope" } }), { status: 400 }));
    expect(await approveTransactions(CONFIG, ids)).toEqual({ ok: false, reason: "nope", approved: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an empty list", async () => {
    expect(await approveTransactions(CONFIG, [])).toEqual({ ok: true, approved: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("splitTransaction", () => {
  const txn = (extra: Record<string, unknown> = {}) => json({ transaction: { id: "t", amount: -50000, subtransactions: [], ...extra } });

  it("applies the transaction's own sign and sends category_id null", async () => {
    fetchMock.mockResolvedValueOnce(txn()).mockResolvedValueOnce(json({}));
    const res = await splitTransaction(CONFIG, "t", [
      { categoryId: "groceries", amount: 30 },
      { categoryId: "household", amount: 20, memo: "soap" },
    ]);
    expect(res).toEqual({ ok: true });
    const patch = calls()[1];
    expect(patch.init.method).toBe("PATCH");
    expect(JSON.parse(String(patch.init.body))).toEqual({
      transactions: [
        {
          id: "t",
          category_id: null,
          subtransactions: [
            { amount: -30000, category_id: "groceries" },
            { amount: -20000, category_id: "household", memo: "soap" },
          ],
        },
      ],
    });
  });

  it("refuses lines that don't add up to YNAB's amount", async () => {
    fetchMock.mockResolvedValueOnce(txn());
    const res = await splitTransaction(CONFIG, "t", [
      { categoryId: "a", amount: 30 },
      { categoryId: "b", amount: 10 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("40.00");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a transaction that is already split", async () => {
    fetchMock.mockResolvedValueOnce(txn({ subtransactions: [{ id: "s" }] }));
    const res = await splitTransaction(CONFIG, "t", [
      { categoryId: "a", amount: 25 },
      { categoryId: "b", amount: 25 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("already split");
  });

  it("validates before touching the network", async () => {
    expect((await splitTransaction(CONFIG, "t", [{ categoryId: "a", amount: 50 }])).ok).toBe(false);
    expect((await splitTransaction(CONFIG, "t", [{ categoryId: "", amount: 25 }, { categoryId: "b", amount: 25 }])).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles cents without floating-point drift", async () => {
    fetchMock.mockResolvedValueOnce(txn({ amount: -30000 })).mockResolvedValueOnce(json({}));
    const res = await splitTransaction(CONFIG, "t", [
      { categoryId: "a", amount: 10.1 },
      { categoryId: "b", amount: 19.9 },
    ]);
    expect(res).toEqual({ ok: true });
  });
});

describe("month helpers", () => {
  it("rolls over year boundaries", () => {
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(currentMonthStart(new Date(Date.UTC(2026, 9, 23)))).toBe("2026-10-01");
  });
});

describe("getNetWorthHistory", () => {
  const thisMonth = currentMonthStart();
  const inMonth = (offset: number) => addMonths(thisMonth, offset).slice(0, 8) + "10";

  it("works backwards from today's balances and ignores hidden accounts", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/accounts")) {
        return json({
          accounts: [
            { id: "a", balance: 10_000_000, closed: false },
            { id: "hidden", balance: 99_000_000, closed: false },
          ],
          server_knowledge: 1,
        });
      }
      return json({
        transactions: [
          { id: "1", account_id: "a", date: inMonth(0), amount: 1_000_000 },
          { id: "2", account_id: "a", date: inMonth(-1), amount: 2_000_000 },
          { id: "3", account_id: "hidden", date: inMonth(-1), amount: 5_000_000 },
        ],
        server_knowledge: 1,
      });
    });

    const res = await getNetWorthHistory({ ...CONFIG, hiddenAccountIds: ["hidden"] }, 3);
    expect(res.ok).toBe(true);
    expect(res.current).toBe(10_000);
    // End of two months ago: remove last month's +2000 and this month's +1000.
    expect(res.points.map((p) => p.netWorth)).toEqual([7000, 9000, 10_000]);
    expect(res.points.map((p) => p.month)).toEqual([addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth]);
    expect(calls().some((c) => c.url.includes(`since_date=${addMonths(thisMonth, -1)}`))).toBe(true);
  });
});

describe("getAccountBalanceHistory", () => {
  const thisMonth = currentMonthStart();
  const inMonth = (offset: number) => addMonths(thisMonth, offset).slice(0, 8) + "10";

  it("rebuilds month-end balances per account and ends on the live balance", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/accounts")) {
        return json({
          accounts: [{ id: "card", balance: -300_000, closed: false }, { id: "other", balance: 1, closed: false }],
          server_knowledge: 1,
        });
      }
      return json({
        transactions: [
          { id: "1", account_id: "card", date: inMonth(0), amount: -100_000 },
          { id: "2", account_id: "card", date: inMonth(-1), amount: -50_000 },
          { id: "3", account_id: "other", date: inMonth(-1), amount: 9_000_000 },
        ],
        server_knowledge: 1,
      });
    });

    const res = await getAccountBalanceHistory(CONFIG, ["card", "missing"], 3);
    expect(res.months).toEqual([addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth]);
    // Two months ago: add back this month's -100 and last month's -50.
    expect(res.balances).toEqual({ card: [-150, -200, -300] });
  });

  it("does nothing for no accounts", async () => {
    expect(await getAccountBalanceHistory(CONFIG, [])).toEqual({ ok: true, months: [], balances: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getMoneyMovements", () => {
  it("names categories, treats null as Ready to Assign, and sorts newest first", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/money_movements")) {
        return json({
          money_movements: [
            { id: "old", moved_at: "2026-09-01T10:00:00Z", month: "2026-09-01", from_category_id: null, to_category_id: "g", amount: 10_000, note: null },
            { id: "new", moved_at: "2026-10-05T10:00:00Z", month: "2026-10-01", from_category_id: "g", to_category_id: "gone", amount: 25_000, note: "trip" },
          ],
          server_knowledge: 1,
        });
      }
      return json({
        category_groups: [{ name: "Bills", hidden: false, deleted: false, categories: [{ id: "g", name: "Groceries", hidden: false, deleted: false }] }],
      });
    });

    const res = await getMoneyMovements(CONFIG);
    expect(res.movements.map((m) => [m.id, m.fromName, m.toName, m.amount, m.date])).toEqual([
      ["new", "Groceries", "Hidden category", 25, "2026-10-05"],
      ["old", "Ready to Assign", "Groceries", 10, "2026-09-01"],
    ]);
  });
});

describe("getSpendingTrends", () => {
  const thisMonth = currentMonthStart();
  const prev = addMonths(thisMonth, -1);

  function mockYnab(counts: { detail: number } = { detail: 0 }) {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (/\/months\/\d{4}-\d{2}-\d{2}$/.test(u)) {
        counts.detail++;
        const month = u.slice(-10);
        return json({
          month: {
            categories: [
              { id: "g", name: "Groceries", budgeted: 400_000, activity: month === thisMonth ? -300_000 : -450_000 },
              { id: "r", name: "Refund", budgeted: 0, activity: 20_000 },
              { id: "cc", name: "Visa", budgeted: 0, activity: -999_000 },
            ],
          },
        });
      }
      if (u.includes("/months")) {
        return json({
          months: [
            { month: addMonths(thisMonth, 1), income: 0, budgeted: 0, activity: 0, to_be_budgeted: 0 },
            { month: thisMonth, income: 5_000_000, budgeted: 400_000, activity: -300_000, to_be_budgeted: 0, age_of_money: 31 },
            { month: prev, income: 4_000_000, budgeted: 400_000, activity: -450_000, to_be_budgeted: 0, age_of_money: 28 },
          ],
          server_knowledge: 1,
        });
      }
      return json({
        category_groups: [
          { name: "Bills", hidden: false, deleted: false, categories: [
            { id: "g", name: "Groceries", hidden: false, deleted: false },
            { id: "r", name: "Refund", hidden: false, deleted: false },
          ] },
          { name: "Credit Card Payments", hidden: false, deleted: false, categories: [{ id: "cc", name: "Visa", hidden: false, deleted: false }] },
        ],
      });
    });
  }

  it("aligns categories to months, skips future months, refunds and card payments", async () => {
    mockYnab();
    const res = await getSpendingTrends(CONFIG, 6);
    expect(res.ok).toBe(true);
    expect(res.months.map((m) => [m.month, m.spent, m.income, m.ageOfMoney])).toEqual([
      [prev, 450, 4000, 28],
      [thisMonth, 300, 5000, 31],
    ]);
    expect(res.categories.map((c) => [c.name, c.spent])).toEqual([["Groceries", [450, 300]]]);
  });

  it("reuses past-month detail but always refetches the current month", async () => {
    const counts = { detail: 0 };
    mockYnab(counts);
    await getSpendingTrends(CONFIG, 6);
    expect(counts.detail).toBe(2);
    await getSpendingTrends(CONFIG, 6);
    expect(counts.detail).toBe(3);
  });
});
