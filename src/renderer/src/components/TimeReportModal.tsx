// Monthly time-by-task report for client billing. Same scrim+panel overlay
// language as SettingsPage/NoteBrowserModal/CommandPalette. Reads straight
// from the time_entries table (see services/timeTracking.ts) grouped by
// project then task, so it stays correct even for tasks since completed or
// deleted in Todoist.

import { useCallback, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { MonthlyReportResult } from "../../../shared/types";
import { currentMonthKey, formatDuration, monthLabel, shiftMonth } from "../lib/time";
import { IconChevronLeft, IconChevronRight, IconX } from "./icons";

interface TimeReportModalProps {
  onClose: () => void;
}

export default function TimeReportModal({ onClose }: TimeReportModalProps) {
  const [month, setMonth] = useState(currentMonthKey());
  const [report, setReport] = useState<MonthlyReportResult | null>(null);

  const load = useCallback(async () => {
    setReport(await window.api.timeTracking.monthlyReport(month));
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleScrimClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return (
    <div className="settings-scrim" onClick={handleScrimClick}>
      <div className="report-panel" role="dialog" aria-modal="true" aria-label="Monthly time report">
        <div className="settings-head">
          <h2>Monthly Time Report</h2>
          <button className="settings-close" onClick={onClose} title="Close">
            <IconX />
          </button>
        </div>

        <div className="report-body">
          <div className="report-month-nav">
            <button
              type="button"
              className="daily-nav-btn"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              title="Previous month"
            >
              <IconChevronLeft />
            </button>
            <span className="report-month-label">{monthLabel(month)}</span>
            <button
              type="button"
              className="daily-nav-btn"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              title="Next month"
            >
              <IconChevronRight />
            </button>
            <button
              type="button"
              className="daily-nav-btn today-btn"
              disabled={month === currentMonthKey()}
              onClick={() => setMonth(currentMonthKey())}
            >
              This month
            </button>
          </div>

          {!report ? (
            <p className="muted">Loading…</p>
          ) : report.projects.length === 0 ? (
            <p className="muted">No time logged in {monthLabel(month)}.</p>
          ) : (
            <>
              {report.projects.map((project) => (
                <div className="report-project" key={project.projectName}>
                  <div className="report-project-head">
                    <h3>{project.projectName}</h3>
                    <span className="report-project-total">{formatDuration(project.totalSeconds)}</span>
                  </div>
                  <ul className="report-task-list">
                    {project.tasks.map((task) => (
                      <li key={task.taskId}>
                        <span className="report-task-name">{task.taskContent}</span>
                        <span className="report-task-total">{formatDuration(task.totalSeconds)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="report-grand-total">
                <span>Total</span>
                <span>{formatDuration(report.totalSeconds)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
