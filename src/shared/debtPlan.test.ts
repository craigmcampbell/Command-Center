import { describe, expect, it } from "vitest";
import { addMonths, carriedBalance, simulate, type SimInput } from "./debtPlan";

const base: Omit<SimInput, "strategy"> = {
  debts: [],
  extra: 0,
  oneTimes: [],
  startMonth: "2026-10",
  customOrder: [],
};

const A = { id: 1, name: "Small", balance: 500, apr: 12, minPayment: 50 };
const B = { id: 2, name: "Big", balance: 5000, apr: 24, minPayment: 100 };

describe("addMonths", () => {
  it("rolls over year boundaries", () => {
    expect(addMonths("2026-10", 3)).toBe("2027-01");
    expect(addMonths("2026-01", 0)).toBe("2026-01");
    expect(addMonths("2026-12", 25)).toBe("2029-01");
  });
});

describe("carriedBalance", () => {
  it("subtracts pay-in-full spending and floors at zero", () => {
    expect(carriedBalance(6200, 1200)).toBe(5000);
    expect(carriedBalance(800, 1200)).toBe(0);
    expect(carriedBalance(-50, 0)).toBe(0);
  });
});

describe("simulate", () => {
  it("accrues APR/12 interest before the payment is applied", () => {
    const r = simulate({ ...base, strategy: "minimums", debts: [{ ...A, balance: 1200, apr: 12, minPayment: 100 }] });
    // interest 12.00, payment 100 -> 1112.00
    expect(r.months[0].interest).toBe(12);
    expect(r.months[0].balance).toBe(1112);
  });

  it("caps the final payment at the balance owed", () => {
    const r = simulate({ ...base, strategy: "minimums", debts: [{ ...A, balance: 60, apr: 0, minPayment: 50 }] });
    expect(r.months).toHaveLength(2);
    expect(r.months[1].payment).toBe(10);
    expect(r.debtFreeMonth).toBe("2026-11");
    expect(r.totalPaid).toBe(60);
  });

  it("minimums baseline ignores the extra payment and one-time payments", () => {
    const withExtra = simulate({
      ...base,
      strategy: "minimums",
      debts: [A, B],
      extra: 500,
      oneTimes: [{ id: 1, month: "2026-10", amount: 1000, targetDebtId: null }],
    });
    const without = simulate({ ...base, strategy: "minimums", debts: [A, B] });
    expect(withExtra.totalInterest).toBe(without.totalInterest);
    expect(withExtra.debtFreeMonth).toBe(without.debtFreeMonth);
  });

  it("snowball targets the smallest balance first, avalanche the highest APR", () => {
    const snow = simulate({ ...base, strategy: "snowball", debts: [B, A], extra: 200 });
    const aval = simulate({ ...base, strategy: "avalanche", debts: [A, B], extra: 200 });
    const firstPayoff = (r: typeof snow) => r.payoffs[0].debtId;
    expect(firstPayoff(snow)).toBe(A.id);
    // avalanche pours the extra into Big (24%), so Small is still paid off by
    // its own minimum later
    expect(aval.months[0].perDebt.find((d) => d.debtId === B.id)!.payment).toBe(300);
    expect(aval.totalInterest).toBeLessThan(snow.totalInterest);
  });

  it("rolls a paid-off debt's minimum into the pool", () => {
    const r = simulate({ ...base, strategy: "snowball", debts: [A, B], extra: 0 });
    const payoffIdx = r.payoffs.find((p) => p.debtId === A.id)!.monthIndex;
    const after = r.months[payoffIdx + 1].perDebt.find((d) => d.debtId === B.id)!;
    expect(after.payment).toBe(150); // own 100 + rolled 50
  });

  it("passes leftover from a paid-off focus debt to the next debt in the same month", () => {
    const r = simulate({
      ...base,
      strategy: "snowball",
      debts: [{ ...A, balance: 100, apr: 0, minPayment: 50 }, { ...B, apr: 0 }],
      extra: 500,
    });
    const m0 = r.months[0];
    expect(m0.perDebt.find((d) => d.debtId === A.id)!.payment).toBe(100);
    // B: min 100 + (550 - 100 spent on A) = 100 + 450
    expect(m0.perDebt.find((d) => d.debtId === B.id)!.payment).toBe(550);
  });

  it("applies a one-time payment to a specific debt, spilling over when it exceeds the balance", () => {
    const r = simulate({
      ...base,
      strategy: "avalanche",
      debts: [{ ...A, balance: 300, apr: 0 }, { ...B, balance: 1000, apr: 0 }],
      oneTimes: [{ id: 1, month: "2026-11", amount: 500, targetDebtId: A.id }],
    });
    const m1 = r.months[1];
    const a = m1.perDebt.find((d) => d.debtId === A.id)!;
    const b = m1.perDebt.find((d) => d.debtId === B.id)!;
    expect(a.balance).toBe(0);
    // A had 250 left after month 0; min 50 + one-time absorbs 200; 300 spills to B
    expect(b.payment).toBe(100 + 300);
  });

  it("follow-the-strategy one-time payments go to the focus debt", () => {
    const r = simulate({
      ...base,
      strategy: "avalanche",
      debts: [{ ...A, apr: 0 }, { ...B, apr: 10 }],
      oneTimes: [{ id: 1, month: "2026-10", amount: 1000, targetDebtId: null }],
    });
    expect(r.months[0].perDebt.find((d) => d.debtId === B.id)!.payment).toBe(1100);
  });

  it("ignores one-time payments dated before the start month", () => {
    const a = simulate({ ...base, strategy: "snowball", debts: [A], oneTimes: [{ id: 1, month: "2026-01", amount: 400, targetDebtId: null }] });
    const b = simulate({ ...base, strategy: "snowball", debts: [A] });
    expect(a.totalPaid).toBe(b.totalPaid);
  });

  it("flags a minimum that never covers the interest instead of looping forever", () => {
    const r = simulate({ ...base, strategy: "minimums", debts: [{ id: 1, name: "Trap", balance: 10000, apr: 30, minPayment: 100 }] });
    expect(r.neverPaysOff).toEqual([1]);
    expect(r.debtFreeMonth).toBeNull();
    expect(r.months.length).toBeLessThanOrEqual(600);
  });

  it("treats debts with no carried balance as already paid off", () => {
    const r = simulate({ ...base, strategy: "snowball", debts: [{ ...A, balance: 0 }, B] });
    expect(r.payoffs.find((p) => p.debtId === A.id)).toBeUndefined();
    expect(r.months[0].perDebt.find((d) => d.debtId === A.id)).toBeUndefined();
    // A's minimum still rolls into B from month one
    expect(r.months[0].perDebt.find((d) => d.debtId === B.id)!.payment).toBe(150);
  });

  it("follows the custom order, appending unlisted debts by list order", () => {
    const r = simulate({ ...base, strategy: "custom", debts: [A, B], extra: 200, customOrder: [2] });
    expect(r.months[0].perDebt.find((d) => d.debtId === B.id)!.payment).toBe(300);
  });

  it("starts at the given month", () => {
    const r = simulate({ ...base, strategy: "snowball", debts: [A], startMonth: "2026-12" });
    expect(r.months[0].month).toBe("2026-12");
  });

  it("returns an empty result with no debts", () => {
    const r = simulate({ ...base, strategy: "snowball", debts: [] });
    expect(r.months).toEqual([]);
    expect(r.debtFreeMonth).toBeNull();
    expect(r.neverPaysOff).toEqual([]);
  });
});
