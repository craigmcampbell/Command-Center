import { describe, expect, it } from "vitest";
import { buildDebtMarkdown, formatDuration, planStartMonth, resolveDebts } from "./debtPlanView";
import { DEBT_STRATEGIES, simulate, type DebtStrategy, type SimResult } from "../../../shared/debtPlan";
import type { DebtItem } from "../../../shared/types";

const debt = (over: Partial<DebtItem>): DebtItem => ({
  id: 1,
  name: "Visa",
  balance: null,
  apr: 20,
  minPayment: 100,
  payInFullSpending: 0,
  payInFullAuto: false,
  ynabAccountId: null,
  cardId: null,
  sortOrder: 0,
  ...over,
});
const account = (balance: number) => [{ id: "a1", name: "Visa", type: "creditCard", balance, hidden: false }];

describe("resolveDebts", () => {
  it("uses the live balance owed minus pay-in-full spending", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "a1", payInFullSpending: 1200 })], account(-6200));
    expect(r.source).toBe("ynab");
    expect(r.carried).toBe(5000);
  });

  it("auto mode subtracts this month's YNAB spending", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "a1", payInFullAuto: true })], account(-6200), { a1: 1200 });
    expect(r.payInFull).toBe(1200);
    expect(r.carried).toBe(5000);
    expect(r.spendingUnknown).toBe(false);
  });

  it("auto mode ignores the typed amount", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "a1", payInFullAuto: true, payInFullSpending: 999 })], account(-6200), { a1: 200 });
    expect(r.carried).toBe(6000);
  });

  it("auto mode caps spending at what is owed", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "a1", payInFullAuto: true })], account(-300), { a1: 800 });
    expect(r.payInFull).toBe(300);
    expect(r.carried).toBe(0);
  });

  it("auto mode with spending not loaded is flagged, not treated as zero spending silently", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "a1", payInFullAuto: true })], account(-6200), null);
    expect(r.spendingUnknown).toBe(true);
    expect(r.carried).toBe(6200);
  });

  it("auto has no effect on an unlinked debt", () => {
    const [r] = resolveDebts([debt({ balance: 500, payInFullAuto: true, payInFullSpending: 50 })], null, {});
    expect(r.payInFull).toBe(50);
  });

  it("treats an account in credit as paid off", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "a1" })], account(75));
    expect(r.carried).toBe(0);
    expect(r.paidOff).toBe(true);
  });

  it("lets a manual balance override the live one", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "a1", balance: 3000 })], account(-6200));
    expect(r.source).toBe("manual");
    expect(r.carried).toBe(3000);
  });

  it("hints when live is more than $1 above carried plus pay-in-full", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "a1", balance: 3000, payInFullSpending: 500 })], account(-3700));
    expect(r.drift).toBe(200);
    const [ok] = resolveDebts([debt({ ynabAccountId: "a1", balance: 3000, payInFullSpending: 500 })], account(-3500.5));
    expect(ok.drift).toBeNull();
  });

  it("flags a debt with no balance source as missing, not paid off", () => {
    const [r] = resolveDebts([debt({})], null);
    expect(r.source).toBe("missing");
    expect(r.paidOff).toBe(false);
  });

  it("falls back to manual when the linked account is not in the list", () => {
    const [r] = resolveDebts([debt({ ynabAccountId: "gone" })], account(-100));
    expect(r.source).toBe("missing");
  });
});

describe("planStartMonth", () => {
  it("honours the next-month toggle across a year end", () => {
    expect(planStartMonth(new Date(2026, 11, 15), false)).toBe("2026-12");
    expect(planStartMonth(new Date(2026, 11, 15), true)).toBe("2027-01");
  });
});

describe("formatDuration", () => {
  it("reads naturally", () => {
    expect(formatDuration(14)).toBe("1 year 2 months");
    expect(formatDuration(1)).toBe("1 month");
    expect(formatDuration(24)).toBe("2 years");
  });
});

describe("buildDebtMarkdown", () => {
  it("emits frontmatter, comparison and schedule", () => {
    const resolved = resolveDebts([debt({ balance: 1000 })], null);
    const simDebts = [{ id: 1, name: "Visa", balance: 1000, apr: 20, minPayment: 100 }];
    const results = Object.fromEntries(
      DEBT_STRATEGIES.map((s) => [
        s.id,
        simulate({ debts: simDebts, strategy: s.id, extra: 50, oneTimes: [], startMonth: "2026-10", customOrder: [] }),
      ])
    ) as Record<DebtStrategy, SimResult>;
    const md = buildDebtMarkdown({
      exportedOn: "2026-10-24",
      plan: { extra: 50, strategy: "avalanche", startsNextMonth: false, customOrder: [] },
      startMonth: "2026-10",
      resolved,
      oneTimes: [],
      results,
    });
    expect(md.startsWith("---\nexported: 2026-10-24\n")).toBe(true);
    expect(md).toContain("strategy: Avalanche");
    expect(md).toContain(`debt_free: ${results.avalanche.debtFreeMonth}`);
    expect(md).toContain("## Strategy comparison");
    expect(md).toContain("| 2026-10 |");
  });
});
