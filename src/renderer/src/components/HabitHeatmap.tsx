import type { HabitHeatmapResult } from "../../../shared/types";

interface HabitHeatmapProps {
  data: HabitHeatmapResult;
}

/** Monday=0 .. Sunday=6, matching this app's Monday-start week elsewhere
 *  (getWeekStart in services/habits.ts). */
function weekdayRow(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 6 : day - 1;
}

export default function HabitHeatmap({ data }: HabitHeatmapProps) {
  const { days, totalDone, totalSkipped } = data;
  if (days.length === 0) return null;

  const leadingBlanks = weekdayRow(days[0].date);
  const cells: (HabitHeatmapResult["days"][number] | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...days,
  ];

  return (
    <div className="habit-heatmap">
      <div className="habit-heatmap-grid" role="img" aria-label={`${data.habit.name} year heatmap`}>
        {cells.map((day, i) => (
          <div
            key={day ? day.date : `blank-${i}`}
            className={`habit-heatmap-cell ${day?.status ?? ""}`}
            title={day ? `${day.date}${day.status ? ` — ${day.status}` : ""}` : undefined}
          />
        ))}
      </div>
      <div className="habit-heatmap-summary muted">
        {totalDone} done · {totalSkipped} skipped in the last year
      </div>
    </div>
  );
}
