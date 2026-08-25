import { useCallback, useEffect, useState } from "react";
import type {
  Habit,
  HabitFrequencyType,
  HabitHeatmapResult,
  HabitStreak,
  HabitTrendResult,
  HabitWeekEntry,
  HabitWeekView,
} from "../../../shared/types";

function shiftWeek(weekStart: string, delta: number): string {
  const d = new Date(weekStart + "T12:00:00");
  d.setDate(d.getDate() + delta * 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function reorderTrends(trends: HabitTrendResult[], habits: HabitWeekEntry[]): HabitTrendResult[] {
  const byId = new Map(trends.map((t) => [t.habit.id, t]));
  return habits
    .map((h) => byId.get(h.habit.id))
    .filter((t): t is HabitTrendResult => t != null);
}

/** All data-fetching and mutation for the Habits tab, kept out of
 *  HabitsWidget so its now-larger surface (week, trends, streaks,
 *  categories, archived list) doesn't pile more useState onto the
 *  component. Self-contained rather than App.tsx-fed, matching the one
 *  existing exception in this app's "state lives in App.tsx" convention. */
export function useHabits() {
  const [week, setWeek] = useState<HabitWeekView | null>(null);
  const [trends, setTrends] = useState<HabitTrendResult[]>([]);
  const [streaks, setStreaks] = useState<Map<number, HabitStreak>>(new Map());
  const [categories, setCategories] = useState<string[]>([]);
  const [archivedHabits, setArchivedHabits] = useState<Habit[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [heatmapHabitId, setHeatmapHabitIdState] = useState<number | null>(null);
  const [heatmapData, setHeatmapData] = useState<HabitHeatmapResult | null>(null);

  const load = useCallback(async (weekStart?: string) => {
    const [weekData, trendData, streakData, categoryData] = await Promise.all([
      window.api.habits.getWeek(weekStart),
      window.api.habits.trends(),
      window.api.habits.streaks(),
      window.api.habits.categories(),
    ]);
    setWeek(weekData);
    setTrends(trendData as HabitTrendResult[]);
    setStreaks(new Map((streakData as HabitStreak[]).map((s) => [s.habitId, s])));
    setCategories(categoryData);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshTrendsAndStreaks = useCallback(async () => {
    const [trendData, streakData] = await Promise.all([
      window.api.habits.trends(),
      window.api.habits.streaks(),
    ]);
    setTrends(trendData as HabitTrendResult[]);
    setStreaks(new Map((streakData as HabitStreak[]).map((s) => [s.habitId, s])));
  }, []);

  const loadArchived = useCallback(async () => {
    const all = await window.api.habits.list(true);
    setArchivedHabits(all.filter((h) => h.archived));
  }, []);

  async function navigate(delta: number) {
    if (!week) return;
    await load(shiftWeek(week.weekStart, delta));
  }

  async function goToday() {
    await load();
  }

  async function toggle(habitId: number, date: string) {
    const updated = await window.api.habits.toggle(habitId, date);
    setWeek(updated);
    await refreshTrendsAndStreaks();
  }

  async function setNote(habitId: number, date: string, note: string | null) {
    const updated = await window.api.habits.setCompletionNote(habitId, date, note);
    setWeek(updated);
  }

  function reorderLocal(reorderedHabits: HabitWeekEntry[]) {
    setWeek((prev) => (prev ? { ...prev, habits: reorderedHabits } : prev));
    setTrends((prev) => reorderTrends(prev, reorderedHabits));
  }

  async function persistReorder(orderedIds: number[]) {
    await window.api.habits.reorder(orderedIds);
  }

  async function add(
    name: string,
    frequencyType: HabitFrequencyType,
    targetCount?: number,
    category?: string | null
  ) {
    await window.api.habits.add(name, frequencyType, targetCount, category);
    await load(week?.weekStart);
  }

  async function update(
    id: number,
    name: string,
    frequencyType: HabitFrequencyType,
    targetCount?: number,
    category?: string | null
  ) {
    await window.api.habits.update(id, name, frequencyType, targetCount, category);
    await load(week?.weekStart);
  }

  async function archive(id: number) {
    await window.api.habits.archive(id);
    if (archivedHabits) await loadArchived();
    await load(week?.weekStart);
  }

  async function restore(id: number) {
    await window.api.habits.restore(id);
    await loadArchived();
    await load(week?.weekStart);
  }

  async function remove(id: number) {
    await window.api.habits.remove(id);
    await loadArchived();
  }

  async function setHeatmapHabitId(habitId: number | null) {
    setHeatmapHabitIdState(habitId);
    if (habitId == null) {
      setHeatmapData(null);
      return;
    }
    const data = await window.api.habits.heatmap(habitId);
    setHeatmapData(data);
  }

  return {
    week,
    trends,
    streaks,
    categories,
    archivedHabits,
    loaded,
    heatmapHabitId,
    heatmapData,
    navigate,
    goToday,
    toggle,
    setNote,
    reorderLocal,
    persistReorder,
    add,
    update,
    archive,
    restore,
    remove,
    loadArchived,
    setHeatmapHabitId,
  };
}
