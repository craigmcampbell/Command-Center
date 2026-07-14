// Habit tracker — habits + per-day completions in SQLite. Weekly views and
// trend data are computed from completions at read time.

import { getDatabase } from "./db";
import type {
  Habit,
  HabitFrequencyType,
  HabitTrendResult,
  HabitWeekView,
} from "../../shared/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function initHabits(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    frequency_type TEXT NOT NULL CHECK (frequency_type IN ('daily', 'weekly', 'times_per_week')),
    target_count INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS habit_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    completed_date TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(habit_id, completed_date)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_habit_completions_habit_date
    ON habit_completions(habit_id, completed_date)`);
}

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Monday of the week containing `date` (local time). */
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatLocalDate(d);
}

export function getWeekDates(weekStart: string): string[] {
  const start = parseLocalDate(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY_MS);
    return formatLocalDate(d);
  });
}

function weekTarget(habit: Habit): number {
  switch (habit.frequencyType) {
    case "daily":
      return 7;
    case "weekly":
      return 1;
    case "times_per_week":
      return habit.targetCount;
  }
}

function goalMet(habit: Habit, count: number): boolean {
  return count >= weekTarget(habit);
}

function rowToHabit(row: {
  id: number;
  name: string;
  frequency_type: HabitFrequencyType;
  target_count: number;
  sort_order: number;
  created_at: number;
}): Habit {
  return {
    id: row.id,
    name: row.name,
    frequencyType: row.frequency_type,
    targetCount: row.target_count,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function listHabitRows(): Habit[] {
  return (
    getDatabase()
      .prepare(
        `SELECT id, name, frequency_type, target_count, sort_order, created_at
         FROM habits ORDER BY sort_order ASC, id ASC`
      )
      .all() as Parameters<typeof rowToHabit>[0][]
  ).map(rowToHabit);
}

export function listHabits(): Habit[] {
  return listHabitRows();
}

export function addHabit(
  name: string,
  frequencyType: HabitFrequencyType,
  targetCount = 1
): Habit[] {
  const db = getDatabase();
  const trimmed = name.trim();
  if (!trimmed) return listHabitRows();

  const count =
    frequencyType === "times_per_week" ? Math.max(1, Math.min(7, targetCount)) : 1;
  const { maxOrder } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM habits`)
    .get() as { maxOrder: number };

  db.prepare(
    `INSERT INTO habits (name, frequency_type, target_count, sort_order) VALUES (?, ?, ?, ?)`
  ).run(trimmed, frequencyType, count, maxOrder + 1);

  return listHabitRows();
}

export function updateHabit(
  id: number,
  name: string,
  frequencyType: HabitFrequencyType,
  targetCount = 1
): Habit[] {
  const trimmed = name.trim();
  if (!trimmed) return listHabitRows();

  const count =
    frequencyType === "times_per_week" ? Math.max(1, Math.min(7, targetCount)) : 1;
  getDatabase()
    .prepare(
      `UPDATE habits SET name = ?, frequency_type = ?, target_count = ? WHERE id = ?`
    )
    .run(trimmed, frequencyType, count, id);

  return listHabitRows();
}

export function removeHabit(id: number): Habit[] {
  getDatabase().prepare(`DELETE FROM habits WHERE id = ?`).run(id);
  return listHabitRows();
}

export function reorderHabits(orderedIds: number[]): Habit[] {
  const update = getDatabase().prepare(`UPDATE habits SET sort_order = ? WHERE id = ?`);
  const updateAll = getDatabase().transaction((ids: number[]) => {
    ids.forEach((id, i) => update.run(i, id));
  });
  updateAll(orderedIds);
  return listHabitRows();
}

function completionsForWeek(
  habitIds: number[],
  weekDates: string[]
): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  if (habitIds.length === 0) return map;

  const placeholders = habitIds.map(() => "?").join(", ");
  const datePlaceholders = weekDates.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT habit_id, completed_date FROM habit_completions
       WHERE habit_id IN (${placeholders}) AND completed_date IN (${datePlaceholders})`
    )
    .all(...habitIds, ...weekDates) as { habit_id: number; completed_date: string }[];

  for (const row of rows) {
    let set = map.get(row.habit_id);
    if (!set) {
      set = new Set();
      map.set(row.habit_id, set);
    }
    set.add(row.completed_date);
  }
  return map;
}

export function getWeekView(weekStart?: string): HabitWeekView {
  const start = weekStart ?? getWeekStart();
  const dates = getWeekDates(start);
  const habits = listHabitRows();
  const completionMap = completionsForWeek(
    habits.map((h) => h.id),
    dates
  );

  return {
    weekStart: start,
    weekEnd: dates[6],
    days: dates.map((date) => ({
      date,
      label: parseLocalDate(date).toLocaleDateString("en-US", { weekday: "short" }),
    })),
    habits: habits.map((habit) => {
      const done = completionMap.get(habit.id) ?? new Set<string>();
      const completions: Record<string, boolean> = {};
      for (const date of dates) {
        completions[date] = done.has(date);
      }
      const weekCount = done.size;
      const target = weekTarget(habit);
      return {
        habit,
        completions,
        weekCount,
        weekTarget: target,
        goalMet: goalMet(habit, weekCount),
      };
    }),
  };
}

export function toggleCompletion(habitId: number, date: string): HabitWeekView {
  const db = getDatabase();
  const existing = db
    .prepare(`SELECT id FROM habit_completions WHERE habit_id = ? AND completed_date = ?`)
    .get(habitId, date) as { id: number } | undefined;

  if (existing) {
    db.prepare(`DELETE FROM habit_completions WHERE id = ?`).run(existing.id);
  } else {
    db.prepare(`INSERT INTO habit_completions (habit_id, completed_date) VALUES (?, ?)`).run(
      habitId,
      date
    );
  }

  const weekStart = getWeekStart(parseLocalDate(date));
  return getWeekView(weekStart);
}

export function getHabitTrends(habitId: number, numWeeks = 12): HabitTrendResult | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, name, frequency_type, target_count, sort_order, created_at
       FROM habits WHERE id = ?`
    )
    .get(habitId) as Parameters<typeof rowToHabit>[0] | undefined;

  if (!row) return null;

  const habit = rowToHabit(row);
  const currentWeekStart = getWeekStart();
  const weeks: HabitTrendResult["weeks"] = [];

  for (let i = numWeeks - 1; i >= 0; i--) {
    const startDate = parseLocalDate(currentWeekStart);
    startDate.setDate(startDate.getDate() - i * 7);
    const weekStart = formatLocalDate(startDate);
    const dates = getWeekDates(weekStart);

    const { count } = getDatabase()
      .prepare(
        `SELECT COUNT(*) as count FROM habit_completions
         WHERE habit_id = ? AND completed_date IN (${dates.map(() => "?").join(", ")})`
      )
      .get(habitId, ...dates) as { count: number };

    const target = weekTarget(habit);
    const rate = Math.min(count / target, 1);

    weeks.push({
      weekStart,
      weekLabel: parseLocalDate(weekStart).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      completed: count,
      target,
      rate,
      goalMet: goalMet(habit, count),
    });
  }

  return { habit, weeks };
}

export function getAllHabitTrends(numWeeks = 12): HabitTrendResult[] {
  return listHabitRows()
    .map((h) => getHabitTrends(h.id, numWeeks))
    .filter((t): t is HabitTrendResult => t !== null);
}
