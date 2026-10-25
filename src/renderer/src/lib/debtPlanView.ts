// View-side glue for the Debt tab: turning stored Debts + live YNAB balances
// into the carried balances the shared simulation consumes, and rendering the
// Markdown export. Pure — the clock and the live data are passed in.

import type { DebtItem, DebtOneTimePayment, DebtPlanSettings, YnabAccount } from "../../../shared/types";
import {
  DEBT_STRATEGIES,
  addMonths,
  carriedBalance,
  type DebtStrategy,
  type SimDebt,
  type SimResult,
} from "../../../shared/debtPlan";

export interface ResolvedDebt {
  debt: DebtItem;
  /** Live balance owed from the linked YNAB account (0 if the account is in credit). */
  live: number | null;
  /** Where the plan's starting balance came from. */
  source: "manual" | "ynab" | "missing";
  carried: number;
  /** Pay-in-full spending actually subtracted (auto from YNAB, or typed). */
  payInFull: number;
  /** Auto mode was on but this month's spending couldn't be read. */
  spendingUnknown: boolean;
  paidOff: boolean;
  /** Display-only: the live balance is above what the plan assumes. */
  drift: number | null;
}

const DRIFT_THRESHOLD = 1;

/**
 * `spending` is month-to-date spending per YNAB account id; null means it
 * hasn't loaded (or failed), which an auto debt treats as unknown, not zero.
 */
export function resolveDebts(
  debts: DebtItem[],
  accounts: YnabAccount[] | null,
  spending: Record<string, number> | null = null
): ResolvedDebt[] {
  return debts.map((debt) => {
    const account = debt.ynabAccountId ? accounts?.find((a) => a.id === debt.ynabAccountId) : undefined;
    // Only a negative balance counts as owed; an overpaid account is zero, not debt.
    const live = account ? Math.max(0, -account.balance) : null;
    const auto = debt.payInFullAuto && debt.ynabAccountId !== null;
    const known = auto && spending !== null && debt.ynabAccountId! in spending;
    // Never subtract more than the card actually owes.
    const payInFull = auto ? (known ? Math.min(spending![debt.ynabAccountId!], live ?? 0) : 0) : debt.payInFullSpending;
    let carried: number;
    let source: ResolvedDebt["source"];
    if (debt.balance !== null) {
      carried = Math.max(0, debt.balance);
      source = "manual";
    } else if (live !== null) {
      carried = carriedBalance(live, payInFull);
      source = "ynab";
    } else {
      carried = 0;
      source = "missing";
    }
    const over = source === "manual" && live !== null ? live - (carried + payInFull) : 0;
    return {
      debt,
      live,
      source,
      carried,
      payInFull,
      spendingUnknown: auto && source === "ynab" && !known,
      paidOff: source !== "missing" && carried < 0.005,
      drift: over > DRIFT_THRESHOLD ? Math.round(over * 100) / 100 : null,
    };
  });
}

export function toSimDebts(resolved: ResolvedDebt[]): SimDebt[] {
  return resolved.map((r) => ({
    id: r.debt.id,
    name: r.debt.name,
    balance: r.carried,
    apr: r.debt.apr,
    minPayment: r.debt.minPayment,
  }));
}

/** Month one of the projection as "YYYY-MM", from the user's local clock. */
export function planStartMonth(now: Date, startsNextMonth: boolean): string {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return startsNextMonth ? addMonths(current, 1) : current;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonth(month: string | null): string {
  if (!month) return "—";
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function formatMoney(n: number, cents = false): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

/** "14 months" / "3 years 2 months" for a month count. */
export function formatDuration(months: number): string {
  if (months <= 0) return "0 months";
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} year${y === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} month${m === 1 ? "" : "s"}`);
  return parts.join(" ");
}

export interface MarkdownInput {
  exportedOn: string;
  plan: DebtPlanSettings;
  startMonth: string;
  resolved: ResolvedDebt[];
  oneTimes: DebtOneTimePayment[];
  results: Record<DebtStrategy, SimResult>;
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function strategyLabel(id: DebtStrategy): string {
  return DEBT_STRATEGIES.find((s) => s.id === id)?.label ?? id;
}

export function buildDebtMarkdown(input: MarkdownInput): string {
  const { plan, resolved, oneTimes, results, startMonth } = input;
  const selected = results[plan.strategy];
  const baseline = results.minimums;
  const nameOf = (id: number | null) =>
    id === null ? "Follow strategy" : (resolved.find((r) => r.debt.id === id)?.debt.name ?? "Removed debt");
  const active = resolved.filter((r) => !r.paidOff && r.source !== "missing");

  const lines: string[] = [
    "---",
    `exported: ${input.exportedOn}`,
    `strategy: ${strategyLabel(plan.strategy)}`,
    `start_month: ${startMonth}`,
    `extra_monthly: ${plan.extra.toFixed(2)}`,
    `debt_free: ${selected.debtFreeMonth ?? "never"}`,
    `total_interest: ${selected.totalInterest.toFixed(2)}`,
    `total_paid: ${selected.totalPaid.toFixed(2)}`,
    `starting_balance: ${active.reduce((s, r) => s + r.carried, 0).toFixed(2)}`,
    "---",
    "",
    `# Debt paydown plan — ${input.exportedOn}`,
    "",
    "## Plan inputs",
    "",
    "Balances are carried balances (what is being paid down), not statement balances.",
    "",
    "| Debt | Carried balance | Source | APR | Minimum | Pay-in-full spending (month to date) |",
    "| --- | ---: | --- | ---: | ---: | ---: |",
    ...resolved.map(
      (r) =>
        `| ${cell(r.debt.name)} | ${formatMoney(r.carried, true)} | ${
          r.source === "ynab" ? "YNAB" : r.source === "manual" ? "manual" : "not set"
        } | ${r.debt.apr}% | ${formatMoney(r.debt.minPayment, true)} | ${formatMoney(r.payInFull, true)} |`
    ),
    "",
    `- Extra monthly payment: ${formatMoney(plan.extra, true)}`,
    `- Starts: ${formatMonth(startMonth)}`,
    "",
  ];

  if (oneTimes.length) {
    lines.push("### One-time payments", "", "| Month | Amount | Target |", "| --- | ---: | --- |");
    for (const o of oneTimes) {
      lines.push(`| ${formatMonth(o.month)} | ${formatMoney(o.amount, true)} | ${cell(nameOf(o.targetDebtId))} |`);
    }
    lines.push("");
  }

  lines.push(
    "## Strategy comparison",
    "",
    "| Strategy | Debt-free | Months | Total interest | Total paid | Interest saved vs minimums |",
    "| --- | --- | ---: | ---: | ---: | ---: |"
  );
  for (const s of DEBT_STRATEGIES) {
    const r = results[s.id];
    const saved =
      s.id === "minimums" || !r.debtFreeMonth || !baseline.debtFreeMonth
        ? "—"
        : formatMoney(baseline.totalInterest - r.totalInterest, true);
    lines.push(
      `| ${s.label}${s.id === plan.strategy ? " ✓" : ""} | ${formatMonth(r.debtFreeMonth)} | ${
        r.debtFreeMonth ? r.months.length : "—"
      } | ${formatMoney(r.totalInterest, true)} | ${formatMoney(r.totalPaid, true)} | ${saved} |`
    );
  }
  lines.push("");

  if (selected.payoffs.length) {
    lines.push(`## Payoff order — ${strategyLabel(plan.strategy)}`, "");
    selected.payoffs.forEach((p, i) => lines.push(`${i + 1}. ${nameOf(p.debtId)} — ${formatMonth(p.month)}`));
    lines.push("");
  }

  const cols = active;
  lines.push(
    `## Monthly schedule — ${strategyLabel(plan.strategy)}`,
    "",
    `| Month | Payment | Interest | Balance |${cols.map((c) => ` ${cell(c.debt.name)} |`).join("")}`,
    `| --- | ---: | ---: | ---: |${cols.map(() => " ---: |").join("")}`
  );
  for (const m of selected.months) {
    const per = cols
      .map((c) => {
        const d = m.perDebt.find((x) => x.debtId === c.debt.id);
        return ` ${d ? d.balance.toFixed(2) : "0.00"} |`;
      })
      .join("");
    lines.push(`| ${m.month} | ${m.payment.toFixed(2)} | ${m.interest.toFixed(2)} | ${m.balance.toFixed(2)} |${per}`);
  }
  if (!selected.debtFreeMonth) {
    lines.push("", "_Projection stops at 50 years: the minimum payments never clear every balance._");
  }
  lines.push("");
  return lines.join("\n");
}
