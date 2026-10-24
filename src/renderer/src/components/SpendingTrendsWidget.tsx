import { useState } from "react";
import type { YnabCategoryTrend, YnabTrendsResult } from "../../../shared/types";
import Panel from "./Panel";

interface SpendingTrendsWidgetProps {
  data: YnabTrendsResult | null;
}

const TOP_CATEGORIES = 8;

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// "YYYY-MM-01" parsed bare is UTC midnight, which is the previous month in a
// negative-offset zone — pin to local noon, same fix as the other YNAB widgets.
function monthLabel(month: string): string {
  return new Date(month + "T12:00:00").toLocaleDateString("en-US", { month: "short" });
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// The current month is part-way through, so comparing it with a full month
// would make every category look like it is falling. Compare the earlier,
// complete months against each other instead and leave the current one as
// "so far".
function CategoryRow({ category, months }: { category: YnabCategoryTrend; months: string[] }) {
  const past = category.spent.slice(0, -1);
  const baseline = average(past);
  const now = category.spent[category.spent.length - 1] ?? 0;
  const max = Math.max(...category.spent, 1);
  const delta = baseline > 0 ? (now - baseline) / baseline : null;

  return (
    <tr>
      <td className="trend-name" title={category.groupName}>
        {category.name}
      </td>
      <td className="trend-bars">
        <div className="trend-spark" aria-hidden="true">
          {category.spent.map((v, i) => (
            <span
              key={months[i]}
              className={`trend-spark-bar ${i === category.spent.length - 1 ? "current" : ""}`}
              style={{ height: `${Math.max(v > 0 ? 6 : 0, (v / max) * 100)}%` }}
              title={`${monthLabel(months[i])}: ${formatAmount(v)}`}
            />
          ))}
        </div>
      </td>
      <td className="trend-num">{formatAmount(baseline)}</td>
      <td className="trend-num">{formatAmount(now)}</td>
      <td className={`trend-num trend-delta ${delta !== null && delta > 0.1 ? "up" : ""}`}>
        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`}
      </td>
    </tr>
  );
}

export default function SpendingTrendsWidget({ data }: SpendingTrendsWidgetProps) {
  const [showAll, setShowAll] = useState(false);

  let body;
  if (!data) {
    body = <p className="muted">Loading trends…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else if (data.months.length === 0) {
    body = <p className="muted">No budget history yet.</p>;
  } else {
    const months = data.months.map((m) => m.month);
    const scale = Math.max(...data.months.flatMap((m) => [m.income, m.spent]), 1);
    const shown = showAll ? data.categories : data.categories.slice(0, TOP_CATEGORIES);
    body = (
      <>
        <div className="trend-months">
          {data.months.map((m, i) => (
            <div key={m.month} className="trend-month">
              <div className="trend-month-bars">
                <span
                  className="trend-bar income"
                  style={{ height: `${(m.income / scale) * 100}%` }}
                  title={`Income ${formatAmount(m.income)}`}
                />
                <span
                  className="trend-bar spent"
                  style={{ height: `${(m.spent / scale) * 100}%` }}
                  title={`Spent ${formatAmount(m.spent)}`}
                />
              </div>
              <div className="trend-month-label">
                {monthLabel(m.month)}
                {i === data.months.length - 1 ? " ·" : ""}
              </div>
              <div className="trend-month-spent">{formatAmount(m.spent)}</div>
            </div>
          ))}
        </div>
        <div className="trend-legend">
          <span className="trend-key income">Income</span>
          <span className="trend-key spent">Spent</span>
          <span className="muted">Latest month is still in progress.</span>
        </div>
        {data.categories.length > 0 && (
          <table className="ynab-table trend-table">
            <thead>
              <tr>
                <th>Category</th>
                <th aria-label="Monthly spending" />
                <th className="trend-num">Avg prior</th>
                <th className="trend-num">This month</th>
                <th className="trend-num">vs avg</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <CategoryRow key={c.id} category={c} months={months} />
              ))}
            </tbody>
          </table>
        )}
        {data.categories.length > TOP_CATEGORIES && (
          <button type="button" className="row-action trend-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${data.categories.length}`}
          </button>
        )}
      </>
    );
  }

  return (
    <Panel
      title="Spending Trends"
      headerRight={data?.ok ? <span className="pip live"></span> : undefined}
    >
      {body}
    </Panel>
  );
}
