import type { ReactNode } from "react";
import type {
  FirecrawlKeyBucket,
  FirecrawlPeriod,
  FirecrawlUsageResult,
} from "../../../shared/types";
import Panel from "./Panel";

interface FirecrawlUsageWidgetProps {
  data: FirecrawlUsageResult | null;
}

function credits(n: number): string {
  return n.toLocaleString();
}

function formatPeriodDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function periodLabel(start: string | null, end: string | null): { value: string; sub: string } {
  if (start && end) {
    return {
      value: `${formatPeriodDate(start)} – ${formatPeriodDate(end)}`,
      sub: new Date(end).getFullYear().toString(),
    };
  }
  if (start) return { value: formatPeriodDate(start), sub: "start" };
  if (end) return { value: formatPeriodDate(end), sub: "end" };
  return { value: "—", sub: "no billing period" };
}

function monthLabel(start: string | null): string {
  if (!start) return "unknown";
  return new Date(start).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function MonthBars({ periods }: { periods: FirecrawlPeriod[] }) {
  const max = Math.max(...periods.map((p) => p.creditsUsed), 0.01);
  return (
    <div className="claude-bars" role="img" aria-label="Credits used per billing period">
      {periods.map((p, i) => (
        <span
          key={p.startDate ?? i}
          className={`claude-bar ${p.creditsUsed > 0 ? "has-value" : ""}`}
          style={{ height: `${Math.max(2, (p.creditsUsed / max) * 100)}%` }}
          title={`${monthLabel(p.startDate)} — ${credits(p.creditsUsed)} credits`}
        />
      ))}
    </div>
  );
}

export function FirecrawlBreakdown({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: FirecrawlKeyBucket[];
  emptyLabel: string;
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        rows.map((row) => (
          <div className="row openrouter-breakdown-row" key={row.key}>
            <span className="name">{row.label}</span>
            <span className="status">{credits(row.creditsUsed)}</span>
          </div>
        ))
      )}
    </Panel>
  );
}

export default function FirecrawlUsageWidget({ data }: FirecrawlUsageWidgetProps) {
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Loading Firecrawl usage…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else {
    const extra = Math.max(0, data.remainingCredits - data.planCredits);
    const used = data.creditsUsedThisPeriod;
    const usedPercent =
      used != null && data.planCredits > 0 ? Math.min(100, (used / data.planCredits) * 100) : 0;
    const period = periodLabel(data.billingPeriodStart, data.billingPeriodEnd);

    body = (
      <>
        <div className="openrouter-stats">
          <div className="openrouter-stat">
            <span className="openrouter-stat-label">Remaining</span>
            <span className="openrouter-stat-value">{credits(data.remainingCredits)}</span>
            {extra > 0 && (
              <span className="openrouter-stat-sub">{credits(extra)} extra (packs / coupons)</span>
            )}
          </div>
          <div className="openrouter-stat">
            <span className="openrouter-stat-label">Used this period</span>
            <span className="openrouter-stat-value">{used == null ? "—" : credits(used)}</span>
            <span className="openrouter-stat-sub">of {credits(data.planCredits)} plan</span>
          </div>
          <div className="openrouter-stat">
            <span className="openrouter-stat-label">Period</span>
            <span className="openrouter-stat-value firecrawl-period-value">{period.value}</span>
            <span className="openrouter-stat-sub">{period.sub}</span>
          </div>
        </div>
        {data.periods.length > 0 && <MonthBars periods={data.periods} />}
        {used != null && data.planCredits > 0 && (
          <div className="firecrawl-quota">
            <div className="firecrawl-quota-head">
              <span>Plan credits used</span>
              <span>{usedPercent.toFixed(0)}%</span>
            </div>
            <div
              className="firecrawl-quota-track"
              role="progressbar"
              aria-label="Firecrawl plan credits used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usedPercent}
            >
              <span style={{ width: `${usedPercent}%` }} />
            </div>
          </div>
        )}
      </>
    );
  }

  return <Panel title="Firecrawl credits">{body}</Panel>;
}
