import type { ReactNode } from "react";
import type { OpenRouterPeriod, OpenRouterUsageBucket, OpenRouterUsageResult } from "../../../shared/types";
import Panel from "./Panel";

interface OpenRouterUsageWidgetProps {
  data: OpenRouterUsageResult | null;
  period: OpenRouterPeriod;
  onPeriodChange: (period: OpenRouterPeriod) => void;
}

const PERIODS: { id: OpenRouterPeriod; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "30d", label: "30d" },
];

function money(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function totalTokens(t: OpenRouterUsageBucket["tokens"]): number {
  return t.prompt + t.completion + t.reasoning;
}

function PeriodToggle({
  period,
  onChange,
}: {
  period: OpenRouterPeriod;
  onChange: (period: OpenRouterPeriod) => void;
}) {
  return (
    <div className="openrouter-period-toggle" role="group" aria-label="Reporting period">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`openrouter-period-btn ${period === p.id ? "active" : ""}`}
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function OpenRouterBreakdown({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: OpenRouterUsageBucket[];
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
            <span className="status">{compact(totalTokens(row.tokens))} tok</span>
            <span className="openrouter-cost">{money(row.costUsd)}</span>
          </div>
        ))
      )}
    </Panel>
  );
}

export default function OpenRouterUsageWidget({ data, period, onPeriodChange }: OpenRouterUsageWidgetProps) {
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Loading OpenRouter usage…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else {
    const balance = data.creditBalance;
    body = (
      <>
        <div className="openrouter-stats">
          <div className="openrouter-stat">
            <span className="openrouter-stat-label">Spend</span>
            <span className="openrouter-stat-value">{money(data.costUsd)}</span>
            <span className="openrouter-stat-sub">{data.requests.toLocaleString()} requests</span>
          </div>
          <div className="openrouter-stat">
            <span className="openrouter-stat-label">Tokens</span>
            <span className="openrouter-stat-value">{compact(totalTokens(data.tokens))}</span>
            <span className="openrouter-stat-sub">
              in {compact(data.tokens.prompt)} · out {compact(data.tokens.completion)}
              {data.tokens.reasoning > 0 && <> · reasoning {compact(data.tokens.reasoning)}</>}
            </span>
          </div>
          {balance && (
            <div className="openrouter-stat">
              <span className="openrouter-stat-label">Credit balance</span>
              <span className="openrouter-stat-value">{money(balance.remaining)}</span>
              <span className="openrouter-stat-sub">
                {money(balance.totalUsage)} used of {money(balance.totalCredits)}
              </span>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <Panel title="OpenRouter usage" headerRight={<PeriodToggle period={period} onChange={onPeriodChange} />}>
      {body}
    </Panel>
  );
}
