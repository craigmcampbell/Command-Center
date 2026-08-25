import type { HabitStreak, HabitTrendResult } from "../../../shared/types";
import { IconFlame } from "./icons";

interface HabitTrendChartProps {
  trend: HabitTrendResult;
  streak?: HabitStreak;
}

export default function HabitTrendChart({ trend, streak }: HabitTrendChartProps) {
  const { habit, weeks } = trend;
  const barMaxHeight = 48;

  const freqLabel =
    habit.frequencyType === "daily"
      ? "daily"
      : habit.frequencyType === "weekly"
        ? "weekly"
        : `${habit.targetCount}×/wk`;

  const metWeeks = weeks.filter((w) => w.goalMet).length;

  return (
    <div className="habit-trend-card">
      <div className="habit-trend-head">
        <span className="habit-trend-name">{habit.name}</span>
        <span className="habit-trend-meta">
          {streak && streak.current > 0 && (
            <span
              className="habit-streak-badge"
              title={`Longest streak: ${streak.longest}`}
            >
              <IconFlame size={10} />
              {streak.current}
            </span>
          )}
          {freqLabel} · {metWeeks}/{weeks.length} weeks
        </span>
      </div>
      <div className="habit-trend-chart" role="img" aria-label={`${habit.name} trend chart`}>
        {weeks.map((week) => {
          const height = Math.max(2, week.rate * barMaxHeight);
          return (
            <div key={week.weekStart} className="habit-trend-bar-wrap" title={`${week.weekLabel}: ${week.completed}/${week.target}`}>
              <div
                className={`habit-trend-bar ${week.goalMet ? "met" : ""}`}
                style={{ height: `${height}px` }}
              />
              <span className="habit-trend-bar-label">{week.weekLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
