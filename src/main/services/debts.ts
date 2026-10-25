// Debt paydown plan inputs for the Debt tab: the debts, dated one-time
// payments, and the single plan's scalar settings. The projection itself is
// the pure shared/debtPlan.ts — nothing computed is stored.

import { getDatabase } from "./db";
import type {
  DebtInput,
  DebtItem,
  DebtOneTimeInput,
  DebtOneTimePayment,
  DebtPlanSettings,
} from "../../shared/types";
import { DEBT_STRATEGIES } from "../../shared/debtPlan";

const PLAN_KEY = "debtPlan";
const DEFAULT_PLAN: DebtPlanSettings = {
  extra: 0,
  strategy: "avalanche",
  startsNextMonth: false,
  customOrder: [],
};

export function initDebts(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    balance REAL,
    apr REAL NOT NULL,
    min_payment REAL NOT NULL,
    pay_in_full REAL NOT NULL DEFAULT 0,
    pay_in_full_auto INTEGER NOT NULL DEFAULT 1,
    ynab_account_id TEXT,
    card_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  try {
    db.exec(`ALTER TABLE debts ADD COLUMN pay_in_full_auto INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // already migrated
  }
  db.exec(`CREATE TABLE IF NOT EXISTS debt_one_time (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    amount REAL NOT NULL,
    target_debt_id INTEGER
  )`);
}

const money = (n: unknown): number => (Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0);
const monthOk = (m: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

function debtRows(): DebtItem[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, balance, apr, min_payment as minPayment, pay_in_full as payInFullSpending,
              pay_in_full_auto as payInFullAuto,
              ynab_account_id as ynabAccountId, card_id as cardId, sort_order as sortOrder
       FROM debts ORDER BY sort_order ASC, id ASC`
    )
    .all() as (Omit<DebtItem, "payInFullAuto"> & { payInFullAuto: number })[];
  return rows.map((r) => ({ ...r, payInFullAuto: r.payInFullAuto !== 0 }));
}

export function listDebts(): DebtItem[] {
  return debtRows();
}

function clean(input: DebtInput) {
  return {
    name: String(input.name ?? "").trim() || "Untitled debt",
    balance: input.balance === null || input.balance === undefined ? null : money(input.balance),
    apr: money(input.apr),
    minPayment: money(input.minPayment),
    payInFull: money(input.payInFullSpending),
    payInFullAuto: input.payInFullAuto === false ? 0 : 1,
    ynabAccountId: input.ynabAccountId || null,
    cardId: input.cardId ?? null,
  };
}

export function addDebt(input: DebtInput): DebtItem[] {
  const c = clean(input);
  const db = getDatabase();
  const { next } = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM debts`).get() as {
    next: number;
  };
  db.prepare(
    `INSERT INTO debts (name, balance, apr, min_payment, pay_in_full, pay_in_full_auto, ynab_account_id, card_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(c.name, c.balance, c.apr, c.minPayment, c.payInFull, c.payInFullAuto, c.ynabAccountId, c.cardId, next);
  return debtRows();
}

export function updateDebt(id: number, input: DebtInput): DebtItem[] {
  const c = clean(input);
  getDatabase()
    .prepare(
      `UPDATE debts SET name = ?, balance = ?, apr = ?, min_payment = ?, pay_in_full = ?, pay_in_full_auto = ?,
         ynab_account_id = ?, card_id = ? WHERE id = ?`
    )
    .run(c.name, c.balance, c.apr, c.minPayment, c.payInFull, c.payInFullAuto, c.ynabAccountId, c.cardId, id);
  return debtRows();
}

export function removeDebt(id: number): DebtItem[] {
  const db = getDatabase();
  db.prepare(`DELETE FROM debts WHERE id = ?`).run(id);
  // A one-time payment aimed at a deleted debt falls back to the strategy.
  db.prepare(`UPDATE debt_one_time SET target_debt_id = NULL WHERE target_debt_id = ?`).run(id);
  return debtRows();
}

export function reorderDebts(orderedIds: number[]): DebtItem[] {
  const db = getDatabase();
  const update = db.prepare(`UPDATE debts SET sort_order = ? WHERE id = ?`);
  db.transaction((ids: number[]) => ids.forEach((id, i) => update.run(i, id)))(orderedIds);
  return debtRows();
}

function oneTimeRows(): DebtOneTimePayment[] {
  return getDatabase()
    .prepare(
      `SELECT id, month, amount, target_debt_id as targetDebtId FROM debt_one_time ORDER BY month ASC, id ASC`
    )
    .all() as DebtOneTimePayment[];
}

export function listOneTime(): DebtOneTimePayment[] {
  return oneTimeRows();
}

export function addOneTime(input: DebtOneTimeInput): DebtOneTimePayment[] {
  if (!monthOk(input.month)) return oneTimeRows();
  getDatabase()
    .prepare(`INSERT INTO debt_one_time (month, amount, target_debt_id) VALUES (?, ?, ?)`)
    .run(input.month, money(input.amount), input.targetDebtId ?? null);
  return oneTimeRows();
}

export function updateOneTime(id: number, input: DebtOneTimeInput): DebtOneTimePayment[] {
  if (!monthOk(input.month)) return oneTimeRows();
  getDatabase()
    .prepare(`UPDATE debt_one_time SET month = ?, amount = ?, target_debt_id = ? WHERE id = ?`)
    .run(input.month, money(input.amount), input.targetDebtId ?? null, id);
  return oneTimeRows();
}

export function removeOneTime(id: number): DebtOneTimePayment[] {
  getDatabase().prepare(`DELETE FROM debt_one_time WHERE id = ?`).run(id);
  return oneTimeRows();
}

function sanitizePlan(p: Partial<DebtPlanSettings> | undefined): DebtPlanSettings {
  const strategy = DEBT_STRATEGIES.some((s) => s.id === p?.strategy) ? p!.strategy! : DEFAULT_PLAN.strategy;
  return {
    extra: money(p?.extra),
    strategy,
    startsNextMonth: p?.startsNextMonth === true,
    customOrder: Array.isArray(p?.customOrder) ? p!.customOrder!.filter((n) => Number.isInteger(n)) : [],
  };
}

export function getDebtPlan(): DebtPlanSettings {
  const row = getDatabase().prepare(`SELECT value FROM settings WHERE key = ?`).get(PLAN_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_PLAN };
  try {
    return sanitizePlan(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_PLAN };
  }
}

export function setDebtPlan(plan: DebtPlanSettings): DebtPlanSettings {
  const clean = sanitizePlan(plan);
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(PLAN_KEY, JSON.stringify(clean));
  return clean;
}
