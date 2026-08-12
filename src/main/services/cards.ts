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
}

function rowsToItems(): CardItem[] {
  return getDatabase()
    .prepare(
      `SELECT id, name, credit_limit as creditLimit, apr FROM cards ORDER BY name ASC`
    )
    .all() as CardItem[];
}

export function listCards(): CardItem[] {
  return rowsToItems();
}

export function addCard(name: string, creditLimit: number, apr: number): CardItem[] {
  getDatabase()
    .prepare(`INSERT INTO cards (name, credit_limit, apr) VALUES (?, ?, ?)`)
    .run(name, creditLimit, apr);
  return rowsToItems();
}

export function updateCard(
  id: number,
  name: string,
  creditLimit: number,
  apr: number
): CardItem[] {
  getDatabase()
    .prepare(`UPDATE cards SET name = ?, credit_limit = ?, apr = ? WHERE id = ?`)
    .run(name, creditLimit, apr, id);
  return rowsToItems();
}

export function removeCard(id: number): CardItem[] {
  getDatabase().prepare(`DELETE FROM cards WHERE id = ?`).run(id);
  return rowsToItems();
}
