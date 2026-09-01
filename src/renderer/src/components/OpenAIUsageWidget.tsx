import type { ReactNode } from "react";
import type {
  OpenAICostBucket,
  OpenAIPeriod,
  OpenAITokenTotals,
  OpenAIUsageBucket,
  OpenAIUsageResult,
} from "../../../shared/types";
import Panel from "./Panel";

interface OpenAIUsageWidgetProps {
  data: OpenAIUsageResult | null;
  period: OpenAIPeriod;
  onPeriodChange: (period: OpenAIPeriod) => void;
}

const PERIODS: { id: OpenAIPeriod; label: string }[] = [
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

function totalTokens(t: OpenAITokenTotals): number {
  return t.input + t.output;
}

function PeriodToggle({
  period,
  onChange,
}: {
  period: OpenAIPeriod;
  onChange: (period: OpenAIPeriod) => void;
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

export function OpenAIModelBreakdown({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: OpenAIUsageBucket[];
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
            <span className="status">{row.requests.toLocaleString()} reqs</span>
            <span className="openrouter-cost">{compact(totalTokens(row.tokens))} tok</span>
          </div>
        ))
      )}
    </Panel>
  );
}

export function OpenAICostBreakdown({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: OpenAICostBucket[];
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
            <span className="openrouter-cost">{money(row.costUsd)}</span>
          </div>
        ))
      )}
    </Panel>
  );
}

export default function OpenAIUsageWidget({ data, period, onPeriodChange }: OpenAIUsageWidgetProps) {
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Loading OpenAI usage…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else {
    body = (
      <div className="openrouter-stats openai-stats">
        <div className="openrouter-stat">
          <span className="openrouter-stat-label">Spend</span>
          <span className="openrouter-stat-value">{money(data.costUsd)}</span>
          <span className="openrouter-stat-sub">{data.requests.toLocaleString()} requests</span>
        </div>
        <div className="openrouter-stat">
          <span className="openrouter-stat-label">Tokens</span>
          <span className="openrouter-stat-value">{compact(totalTokens(data.tokens))}</span>
          <span className="openrouter-stat-sub">
            in {compact(data.tokens.input)} · out {compact(data.tokens.output)}
            {data.tokens.cached > 0 && <> · cached {compact(data.tokens.cached)}</>}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Panel title="OpenAI API usage" headerRight={<PeriodToggle period={period} onChange={onPeriodChange} />}>
      {body}
    </Panel>
  );
}
