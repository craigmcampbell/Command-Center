import { describe, expect, it } from "vitest";
import { monthSpendingByAccount } from "./ynabInsights";

const t = (over: Record<string, unknown>) => ({
  account_id: "card",
  date: "2026-10-12",
  amount: -50_000,
  payee_name: "Grocer",
  transfer_account_id: null,
  deleted: false,
  ...over,
});

describe("monthSpendingByAccount", () => {
  it("sums purchases for the month and nets refunds", () => {
    const r = monthSpendingByAccount(
      [t({ amount: -50_000 }), t({ amount: -25_500 }), t({ amount: 10_000, payee_name: "Refund" })],
      ["card"],
      "2026-10-01"
    );
    expect(r.card).toBe(65.5);
  });

  it("ignores transfers so a card payment does not cancel spending", () => {
    const r = monthSpendingByAccount(
      [t({ amount: -100_000 }), t({ amount: 100_000, transfer_account_id: "checking", payee_name: "Transfer" })],
      ["card"],
      "2026-10-01"
    );
    expect(r.card).toBe(100);
  });

  it("ignores interest, last month, deleted rows and other accounts", () => {
    const r = monthSpendingByAccount(
      [
        t({ amount: -40_000, payee_name: "Interest Charge" }),
        t({ date: "2026-09-30" }),
        t({ deleted: true }),
        t({ account_id: "other" }),
      ],
      ["card"],
      "2026-10-01"
    );
    expect(r.card).toBe(0);
  });

  it("never goes negative when refunds exceed purchases", () => {
    expect(monthSpendingByAccount([t({ amount: 80_000 })], ["card"], "2026-10-01").card).toBe(0);
  });

  it("reports every requested account", () => {
    expect(monthSpendingByAccount([], ["a", "b"], "2026-10-01")).toEqual({ a: 0, b: 0 });
  });
});
