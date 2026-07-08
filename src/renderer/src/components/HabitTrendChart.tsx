import type { HabitTrendResult } from "../../../shared/types";

interface HabitTrendChartProps {
  trend: HabitTrendResult;
}

export default function HabitTrendChart({ trend }: HabitTrendChartProps) {
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
