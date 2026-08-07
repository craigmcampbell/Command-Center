// Manually-tracked recurring bills for the Finances tab — independent of
// YNAB's own scheduled transactions, since not everything recurring is set
// up as a YNAB schedule (e.g. a bill paid from an external account). Plain
// CRUD over a single SQLite table, same shape as services/links.ts.

import { getDatabase } from "./db";
import type { BillItem } from "../../shared/types";

export function initBills(): void {
  getDatabase().exec(`CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    due_day INTEGER NOT NULL,
    autopay INTEGER NOT NULL DEFAULT 0
  )`);
}

function rowsToItems(): BillItem[] {
  return (
    getDatabase()
      .prepare(`SELECT id, label, due_day as dueDay, autopay FROM bills ORDER BY due_day ASC, label ASC`)
      .all() as (Omit<BillItem, "autopay"> & { autopay: number })[]
  ).map((row) => ({ ...row, autopay: !!row.autopay }));
}

export function listBills(): BillItem[] {
  return rowsToItems();
}

export function addBill(label: string, dueDay: number, autopay: boolean): BillItem[] {
  getDatabase()
    .prepare(`INSERT INTO bills (label, due_day, autopay) VALUES (?, ?, ?)`)
    .run(label, dueDay, autopay ? 1 : 0);
  return rowsToItems();
}

export function updateBill(
  id: number,
  label: string,
  dueDay: number,
  autopay: boolean
): BillItem[] {
  getDatabase()
    .prepare(`UPDATE bills SET label = ?, due_day = ?, autopay = ? WHERE id = ?`)
    .run(label, dueDay, autopay ? 1 : 0, id);
  return rowsToItems();
}

export function removeBill(id: number): BillItem[] {
  getDatabase().prepare(`DELETE FROM bills WHERE id = ?`).run(id);
  return rowsToItems();
}
