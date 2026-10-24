import { useEffect, useState } from "react";
import type {
  CalendarResult,
  GitHubStatusResult,
  ProcessConfig,
  ProcessStatus,
  TodoistResult,
  YnabMonthResult,
  YnabUnapprovedResult,
} from "../../../shared/types";
import { buildTodayItems, todayReady } from "../lib/today";

interface TodayStripProps {
  todoist: TodoistResult | null;
  calendar: CalendarResult | null;
  github: GitHubStatusResult | null;
  unapproved: YnabUnapprovedResult | null;
  budgetHealth: YnabMonthResult | null;
  processStatuses: ProcessStatus[];
  processConfigs: ProcessConfig[];
  onNavigate: (tab: string) => void;
}

// The clock lives here, not in App: a minute tick re-rendering the whole
// dashboard just to keep "in 12m" honest would cost far more than this strip.
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function TodayStrip(props: TodayStripProps) {
  const now = useMinuteClock();
  const { onNavigate, ...sources } = props;
  const items = buildTodayItems({ ...sources, now });

  if (items.length === 0) {
    // Silence until the two main sources have answered; otherwise "all clear"
    // would flash up on every launch before anything has loaded.
    if (!todayReady(sources)) return null;
    return (
      <div className="today-strip" role="status">
        <span className="today-chip today-chip-clear">Nothing needs your attention</span>
      </div>
    );
  }

  return (
    <div className="today-strip" role="status" aria-label="Needs attention">
      {items.map((item) => {
        const className = `today-chip today-chip-${item.severity}`;
        return item.tab ? (
          <button key={item.id} type="button" className={`${className} today-chip-link`} onClick={() => onNavigate(item.tab!)}>
            {item.label}
          </button>
        ) : (
          <span key={item.id} className={className}>
            {item.label}
          </span>
        );
      })}
    </div>
  );
}
