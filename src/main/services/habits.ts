// Habit tracker — habits + per-day completions in SQLite. Weekly views,
// trend data, streaks, and the year heatmap are all computed from
// completions at read time; nothing is cached in the schema.

import { getDatabase } from "./db";
import type {
  Habit,
  HabitCompletionStatus,
  HabitFrequencyType,
  HabitHeatmapResult,
  HabitStreak,
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

  // Additive migrations for columns added after these tables first shipped —
  // CREATE TABLE IF NOT EXISTS alone won't backfill them on an existing
  // install. Each ALTER TABLE is independent and safe to re-run every boot:
  // SQLite errors on a duplicate column, which just means a prior boot
  // already added it. Matches the pattern in services/bills.ts.
  try {
    db.exec(`ALTER TABLE habits ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // already migrated
  }
  try {
    db.exec(`ALTER TABLE habits ADD COLUMN category TEXT`);
  } catch {
    // already migrated
  }
  try {
    db.exec(
      `ALTER TABLE habit_completions ADD COLUMN status TEXT NOT NULL DEFAULT 'done' CHECK(status IN ('done','skipped'))`
    );
  } catch {
    // already migrated
  }
  try {
    db.exec(`ALTER TABLE habit_completions ADD COLUMN note TEXT`);
  } catch {
    // already migrated
  }
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

/** Every date from `fromDate` to `toDate` inclusive, ascending. */
function dateRangeDays(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  const cursor = parseLocalDate(fromDate);
  const end = parseLocalDate(toDate);
  while (cursor <= end) {
    days.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
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
  archived: number;
  category: string | null;
}): Habit {
  return {
    id: row.id,
    name: row.name,
    frequencyType: row.frequency_type,
    targetCount: row.target_count,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    archived: !!row.archived,
    category: row.category,
  };
}

const HABIT_COLUMNS = `id, name, frequency_type, target_count, sort_order, created_at, archived, category`;

function listHabitRows(includeArchived = false): Habit[] {
  const where = includeArchived ? "" : "WHERE archived = 0";
  return (
    getDatabase()
      .prepare(
        `SELECT ${HABIT_COLUMNS} FROM habits ${where} ORDER BY sort_order ASC, id ASC`
      )
      .all() as Parameters<typeof rowToHabit>[0][]
  ).map(rowToHabit);
}

function getHabitRow(id: number): Habit | undefined {
  const row = getDatabase()
    .prepare(`SELECT ${HABIT_COLUMNS} FROM habits WHERE id = ?`)
    .get(id) as Parameters<typeof rowToHabit>[0] | undefined;
  return row ? rowToHabit(row) : undefined;
}

export function listHabits(includeArchived = false): Habit[] {
  return listHabitRows(includeArchived);
}

export function addHabit(
  name: string,
  frequencyType: HabitFrequencyType,
  targetCount = 1,
  category?: string | null
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
    `INSERT INTO habits (name, frequency_type, target_count, sort_order, category) VALUES (?, ?, ?, ?, ?)`
  ).run(trimmed, frequencyType, count, maxOrder + 1, category?.trim() || null);

  return listHabitRows();
}

export function updateHabit(
  id: number,
  name: string,
  frequencyType: HabitFrequencyType,
  targetCount = 1,
  category?: string | null
): Habit[] {
  const trimmed = name.trim();
  if (!trimmed) return listHabitRows();

  const count =
    frequencyType === "times_per_week" ? Math.max(1, Math.min(7, targetCount)) : 1;
  getDatabase()
    .prepare(
      `UPDATE habits SET name = ?, frequency_type = ?, target_count = ?, category = ? WHERE id = ?`
    )
    .run(trimmed, frequencyType, count, category?.trim() || null, id);

  return listHabitRows();
}

/** Permanently deletes a habit and (via cascade) all its completions. Only
 *  reachable from the archived-habits UI — archiving is the everyday path. */
export function removeHabit(id: number): Habit[] {
  getDatabase().prepare(`DELETE FROM habits WHERE id = ?`).run(id);
  return listHabitRows();
}

export function setHabitArchived(id: number, archived: boolean): Habit[] {
  getDatabase()
    .prepare(`UPDATE habits SET archived = ? WHERE id = ?`)
    .run(archived ? 1 : 0, id);
  return listHabitRows();
}

export function getHabitCategories(): string[] {
  return (
    getDatabase()
      .prepare(
        `SELECT DISTINCT category FROM habits WHERE category IS NOT NULL AND category != '' ORDER BY category ASC`
      )
      .all() as { category: string }[]
  ).map((r) => r.category);
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
): Map<number, Map<string, { status: HabitCompletionStatus; note: string | null }>> {
  const map = new Map<number, Map<string, { status: HabitCompletionStatus; note: string | null }>>();
  if (habitIds.length === 0) return map;

  const placeholders = habitIds.map(() => "?").join(", ");
  const datePlaceholders = weekDates.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT habit_id, completed_date, status, note FROM habit_completions
       WHERE habit_id IN (${placeholders}) AND completed_date IN (${datePlaceholders})`
    )
    .all(...habitIds, ...weekDates) as {
    habit_id: number;
    completed_date: string;
    status: HabitCompletionStatus;
    note: string | null;
  }[];

  for (const row of rows) {
    let inner = map.get(row.habit_id);
    if (!inner) {
      inner = new Map();
      map.set(row.habit_id, inner);
    }
    inner.set(row.completed_date, { status: row.status, note: row.note });
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
      const entries = completionMap.get(habit.id) ?? new Map();
      const completions: Record<string, HabitCompletionStatus | undefined> = {};
      const notes: Record<string, string> = {};
      let weekCount = 0;
      for (const date of dates) {
        const entry = entries.get(date);
        completions[date] = entry?.status;
        if (entry?.status === "done") weekCount += 1;
        if (entry?.note) notes[date] = entry.note;
      }
      const target = weekTarget(habit);
      return {
        habit,
        completions,
        notes,
        weekCount,
        weekTarget: target,
        goalMet: goalMet(habit, weekCount),
      };
    }),
  };
}

/** Cycles a day's status: no row -> done -> skipped -> no row. */
export function toggleCompletion(habitId: number, date: string): HabitWeekView {
  const db = getDatabase();
  const existing = db
    .prepare(`SELECT id, status FROM habit_completions WHERE habit_id = ? AND completed_date = ?`)
    .get(habitId, date) as { id: number; status: HabitCompletionStatus } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO habit_completions (habit_id, completed_date, status) VALUES (?, ?, 'done')`
    ).run(habitId, date);
  } else if (existing.status === "done") {
    db.prepare(`UPDATE habit_completions SET status = 'skipped' WHERE id = ?`).run(existing.id);
  } else {
    db.prepare(`DELETE FROM habit_completions WHERE id = ?`).run(existing.id);
  }

  const weekStart = getWeekStart(parseLocalDate(date));
  return getWeekView(weekStart);
}

/** Sets or clears the note on an existing completion. No-op if the day has
 *  no completion row yet — a note only makes sense on a done/skipped day. */
export function setCompletionNote(
  habitId: number,
  date: string,
  note: string | null
): HabitWeekView {
  getDatabase()
    .prepare(`UPDATE habit_completions SET note = ? WHERE habit_id = ? AND completed_date = ?`)
    .run(note?.trim() || null, habitId, date);
  return getWeekView(getWeekStart(parseLocalDate(date)));
}

export function getHabitTrends(habitId: number, numWeeks = 12): HabitTrendResult | null {
  const habit = getHabitRow(habitId);
  if (!habit) return null;

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
         WHERE habit_id = ? AND status = 'done' AND completed_date IN (${dates.map(() => "?").join(", ")})`
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

/** Raw completion history for a habit, ascending by date. Shared by the
 *  streak calculator and the heatmap — both want the full per-day record
 *  rather than `getHabitTrends`'s per-week aggregation. */
export function listCompletions(
  habitId: number,
  fromDate?: string,
  toDate?: string
): { date: string; status: HabitCompletionStatus }[] {
  const db = getDatabase();
  if (fromDate && toDate) {
    return db
      .prepare(
        `SELECT completed_date as date, status FROM habit_completions
         WHERE habit_id = ? AND completed_date BETWEEN ? AND ? ORDER BY completed_date ASC`
      )
      .all(habitId, fromDate, toDate) as { date: string; status: HabitCompletionStatus }[];
  }
  return db
    .prepare(
      `SELECT completed_date as date, status FROM habit_completions
       WHERE habit_id = ? ORDER BY completed_date ASC`
    )
    .all(habitId) as { date: string; status: HabitCompletionStatus }[];
}

/** Daily-frequency streak: walk day by day. `done` continues/increments the
 *  run, `skipped` is neutral (neither breaks nor increments it), a day with
 *  no row breaks it. Today having no row yet is never itself a break —
 *  evaluation of the current streak starts at yesterday in that case. */
function dailyStreak(habit: Habit, completions: Map<string, HabitCompletionStatus>): HabitStreak {
  const today = formatLocalDate(new Date());
  const createdDate = formatLocalDate(new Date(habit.createdAt * 1000));
  const start = createdDate < today ? createdDate : today;
  const days = dateRangeDays(start, today);

  let longest = 0;
  let running = 0;
  for (const day of days) {
    const status = completions.get(day);
    if (status === "done") {
      running += 1;
      longest = Math.max(longest, running);
    } else if (status !== "skipped") {
      running = 0;
    }
  }

  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    const status = completions.get(day);
    if (day === today && status === undefined) continue;
    if (status === "done") {
      current += 1;
    } else if (status === "skipped") {
      continue;
    } else {
      break;
    }
  }

  return { habitId: habit.id, current, longest };
}

/** Weekly/times-per-week streak: consecutive weeks where the done-only count
 *  met the habit's weekly target — the same definition `getWeekView` uses
 *  for `goalMet`. The current, still-in-progress week never counts as a
 *  break just for not having met goal yet; it's included only if it already
 *  has. */
function weeklyStreak(habit: Habit, completions: Map<string, HabitCompletionStatus>): HabitStreak {
  const target = weekTarget(habit);
  const currentWeekStart = getWeekStart();
  const createdWeekStart = getWeekStart(new Date(habit.createdAt * 1000));

  const weekStarts: string[] = [];
  const cursor = parseLocalDate(createdWeekStart);
  const currentStart = parseLocalDate(currentWeekStart);
  while (cursor <= currentStart) {
    weekStarts.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  const metCache = new Map<string, boolean>();
  function weekMet(weekStart: string): boolean {
    let met = metCache.get(weekStart);
    if (met !== undefined) return met;
    let count = 0;
    for (const d of getWeekDates(weekStart)) {
      if (completions.get(d) === "done") count += 1;
    }
    met = count >= target;
    metCache.set(weekStart, met);
    return met;
  }

  const elapsedWeeks = weekStarts.filter((ws) => ws !== currentWeekStart);
  let longest = 0;
  let running = 0;
  for (const ws of elapsedWeeks) {
    if (weekMet(ws)) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }
  if (weekMet(currentWeekStart)) {
    running += 1;
    longest = Math.max(longest, running);
  }

  const currentWeekMet = weekMet(currentWeekStart);
  let current = currentWeekMet ? 1 : 0;
  for (let i = elapsedWeeks.length - 1; i >= 0; i--) {
    if (weekMet(elapsedWeeks[i])) {
      current += 1;
    } else {
      break;
    }
  }

  return { habitId: habit.id, current, longest };
}

export function getHabitStreak(habitId: number): HabitStreak | null {
  const habit = getHabitRow(habitId);
  if (!habit) return null;
  const completions = new Map(listCompletions(habitId).map((c) => [c.date, c.status]));
  return habit.frequencyType === "daily"
    ? dailyStreak(habit, completions)
    : weeklyStreak(habit, completions);
}

/** Streaks for active (non-archived) habits only. */
export function getAllHabitStreaks(): HabitStreak[] {
  return listHabitRows()
    .map((h) => getHabitStreak(h.id))
    .filter((s): s is HabitStreak => s !== null);
}

export function getHabitHeatmap(
  habitId: number,
  fromDate?: string,
  toDate?: string
): HabitHeatmapResult | null {
  const habit = getHabitRow(habitId);
  if (!habit) return null;

  const to = toDate ?? formatLocalDate(new Date());
  const from =
    fromDate ??
    (() => {
      const d = parseLocalDate(to);
      d.setDate(d.getDate() - 364);
      return formatLocalDate(d);
    })();

  const completions = new Map(listCompletions(habitId, from, to).map((c) => [c.date, c.status]));

  let totalDone = 0;
  let totalSkipped = 0;
  const days = dateRangeDays(from, to).map((date) => {
    const status = completions.get(date) ?? null;
    if (status === "done") totalDone += 1;
    else if (status === "skipped") totalSkipped += 1;
    return { date, status };
  });

  return { habit, days, totalDone, totalSkipped };
}
