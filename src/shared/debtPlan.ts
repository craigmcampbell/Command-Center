// Debt paydown projection. Pure — no I/O, no clock — so the Debt tab can
// recompute on every keystroke and the rules can be tested directly. Money is
// dollars rounded to cents at every step, so a schedule adds up exactly.
//
// Order within a month: interest accrues, minimums are paid (capped at the
// balance), the extra pool is poured into debts in strategy order, then
// that month's one-time payments. See GLOSSARY.md for the vocabulary.

export type DebtStrategy = "snowball" | "avalanche" | "custom" | "minimums";

export const DEBT_STRATEGIES: { id: DebtStrategy; label: string; blurb: string }[] = [
  { id: "snowball", label: "Snowball", blurb: "Smallest balance first" },
  { id: "avalanche", label: "Avalanche", blurb: "Highest APR first" },
  { id: "custom", label: "Custom order", blurb: "Your own order" },
  { id: "minimums", label: "Minimums only", blurb: "Baseline — no extra, no rollover" },
];

export interface SimDebt {
  id: number;
  name: string;
  /** Carried balance — what actually accrues interest and gets paid down. */
  balance: number;
  /** Percent, e.g. 24.99. */
  apr: number;
  minPayment: number;
}

export interface SimOneTime {
  id: number;
  /** "YYYY-MM" */
  month: string;
  amount: number;
  /** null = follow the strategy. */
  targetDebtId: number | null;
}

export interface SimInput {
  debts: SimDebt[];
  strategy: DebtStrategy;
  /** Extra monthly amount beyond all minimums. */
  extra: number;
  oneTimes: SimOneTime[];
  /** "YYYY-MM" of month one. */
  startMonth: string;
  /** Debt ids, highest priority first. Only used by "custom". */
  customOrder: number[];
}

export interface SimDebtMonth {
  debtId: number;
  interest: number;
  payment: number;
  /** Balance at the end of the month. */
  balance: number;
}

export interface SimMonth {
  month: string;
  index: number;
  interest: number;
  payment: number;
  balance: number;
  perDebt: SimDebtMonth[];
}

export interface SimPayoff {
  debtId: number;
  month: string;
  monthIndex: number;
}

export interface SimResult {
  months: SimMonth[];
  payoffs: SimPayoff[];
  totalInterest: number;
  totalPaid: number;
  /** Month the last balance reached zero; null if it never does. */
  debtFreeMonth: string | null;
  /** Debts still owing after MAX_MONTHS. */
  neverPaysOff: number[];
}

/** 50 years — long enough that anything still owing is a real "never". */
export const MAX_MONTHS = 600;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.005;

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Live balance owed minus the part cleared in full each month, never below 0. */
export function carriedBalance(owed: number, payInFullSpending: number): number {
  return Math.max(0, round2(owed - Math.max(0, payInFullSpending)));
}

export function simulate(input: SimInput): SimResult {
  const { strategy, extra, oneTimes, startMonth } = input;
  const debts = input.debts.map((d) => ({ ...d, balance: Math.max(0, round2(d.balance)) }));
  const empty: SimResult = {
    months: [],
    payoffs: [],
    totalInterest: 0,
    totalPaid: 0,
    debtFreeMonth: null,
    neverPaysOff: [],
  };
  if (debts.every((d) => d.balance < EPS)) return empty;

  const bal = new Map(debts.map((d) => [d.id, d.balance]));
  const listIndex = new Map(debts.map((d, i) => [d.id, i]));
  const pastZero = new Set(debts.filter((d) => d.balance < EPS).map((d) => d.id));
  const customRank = new Map<number, number>();
  input.customOrder.forEach((id, i) => customRank.set(id, i));
  const rank = (id: number) => customRank.get(id) ?? input.customOrder.length + (listIndex.get(id) ?? 0);

  const months: SimMonth[] = [];
  const payoffs: SimPayoff[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let debtFreeMonth: string | null = null;

  const live = () => debts.filter((d) => (bal.get(d.id) as number) >= EPS);
  const strategyOrder = () => {
    const open = live();
    const li = (d: SimDebt) => listIndex.get(d.id) as number;
    if (strategy === "snowball") {
      open.sort((a, b) => (bal.get(a.id) as number) - (bal.get(b.id) as number) || li(a) - li(b));
    } else if (strategy === "avalanche") {
      open.sort((a, b) => b.apr - a.apr || li(a) - li(b));
    } else if (strategy === "custom") {
      open.sort((a, b) => rank(a.id) - rank(b.id));
    }
    return open;
  };

  for (let index = 0; index < MAX_MONTHS; index++) {
    const month = addMonths(startMonth, index);
    const paid = new Map<number, number>();
    const interest = new Map<number, number>();
    const pay = (id: number, amount: number): number => {
      const owed = bal.get(id) as number;
      const applied = round2(Math.min(Math.max(0, amount), owed));
      if (applied <= 0) return 0;
      bal.set(id, round2(owed - applied));
      paid.set(id, round2((paid.get(id) ?? 0) + applied));
      return applied;
    };

    // 1. interest
    for (const d of live()) {
      const i = round2(((bal.get(d.id) as number) * d.apr) / 1200);
      interest.set(d.id, i);
      bal.set(d.id, round2((bal.get(d.id) as number) + i));
    }

    // 2. minimums; whatever a minimum didn't need is freed up (rollover)
    let pool = strategy === "minimums" ? 0 : Math.max(0, extra);
    for (const d of debts) {
      const spent = (bal.get(d.id) as number) >= EPS ? pay(d.id, d.minPayment) : 0;
      if (strategy !== "minimums") pool = round2(pool + Math.max(0, d.minPayment - spent));
    }

    if (strategy !== "minimums") {
      // 3. the pool, in strategy order
      for (const d of strategyOrder()) {
        if (pool < EPS) break;
        pool = round2(pool - pay(d.id, pool));
      }
      // 4. one-time payments: targeted first, then any remainder follows the strategy
      for (const o of oneTimes) {
        if (o.month !== month) continue;
        let left = o.amount;
        if (o.targetDebtId !== null && bal.has(o.targetDebtId)) {
          left = round2(left - pay(o.targetDebtId, left));
        }
        for (const d of strategyOrder()) {
          if (left < EPS) break;
          left = round2(left - pay(d.id, left));
        }
      }
    }

    const perDebt: SimDebtMonth[] = [];
    let mInterest = 0;
    let mPayment = 0;
    let mBalance = 0;
    for (const d of debts) {
      const b = bal.get(d.id) as number;
      const p = paid.get(d.id) ?? 0;
      const i = interest.get(d.id) ?? 0;
      if (p > 0 || i > 0 || b >= EPS) {
        perDebt.push({ debtId: d.id, interest: i, payment: p, balance: b });
      }
      if (b < EPS && !pastZero.has(d.id)) {
        pastZero.add(d.id);
        payoffs.push({ debtId: d.id, month, monthIndex: index });
      }
      mInterest = round2(mInterest + i);
      mPayment = round2(mPayment + p);
      mBalance = round2(mBalance + b);
    }
    totalInterest = round2(totalInterest + mInterest);
    totalPaid = round2(totalPaid + mPayment);
    months.push({ month, index, interest: mInterest, payment: mPayment, balance: mBalance, perDebt });

    if (mBalance < EPS) {
      debtFreeMonth = month;
      break;
    }
  }

  return {
    months,
    payoffs,
    totalInterest,
    totalPaid,
    debtFreeMonth,
    neverPaysOff: debtFreeMonth ? [] : live().map((d) => d.id),
  };
}
