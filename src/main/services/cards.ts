// Manually-tracked credit cards for the Finances tab's Cards sub-tab — plain
// CRUD over a single SQLite table, same shape as services/bills.ts.

import { getDatabase } from "./db";
import type { CardItem } from "../../shared/types";

export function initCards(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    credit_limit REAL NOT NULL,
    apr REAL NOT NULL
  )`);
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN ynab_account_id TEXT`);
  } catch {
    // already migrated
  }
}

function rowsToItems(): CardItem[] {
  return getDatabase()
    .prepare(
      `SELECT id, name, credit_limit as creditLimit, apr, ynab_account_id as ynabAccountId FROM cards ORDER BY name ASC`
    )
    .all() as CardItem[];
}

export function listCards(): CardItem[] {
  return rowsToItems();
}

export function addCard(
  name: string,
  creditLimit: number,
  apr: number,
  ynabAccountId: string | null
): CardItem[] {
  getDatabase()
    .prepare(`INSERT INTO cards (name, credit_limit, apr, ynab_account_id) VALUES (?, ?, ?, ?)`)
    .run(name, creditLimit, apr, ynabAccountId);
  return rowsToItems();
}

export function updateCard(
  id: number,
  name: string,
  creditLimit: number,
  apr: number,
  ynabAccountId: string | null
): CardItem[] {
  getDatabase()
    .prepare(`UPDATE cards SET name = ?, credit_limit = ?, apr = ?, ynab_account_id = ? WHERE id = ?`)
    .run(name, creditLimit, apr, ynabAccountId, id);
  return rowsToItems();
}

export function removeCard(id: number): CardItem[] {
  getDatabase().prepare(`DELETE FROM cards WHERE id = ?`).run(id);
  return rowsToItems();
}
