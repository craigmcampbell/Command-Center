import type { ReactNode } from "react";
import type {
  ClaudeTokenTotals,
  ClaudeUsageBucket,
  ClaudeUsageResult,
  ClaudeUsageWindow,
} from "../../../shared/types";
import Panel from "./Panel";

interface ClaudeUsageWidgetProps {
  data: ClaudeUsageResult | null;
}

function money(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return n === 0 ? "$0" : `$${n.toFixed(2)}`;
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function totalTokens(t: ClaudeTokenTotals): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
}

// Tokens lead, not dollars. On a subscription the dollar figure is not a bill
// — leading with it implies a charge that never happened. Token volume is the
// thing actually consumed, so it's the headline; cost stays as a secondary
// API-equivalent reference.
function WindowStat({ label, window: w }: { label: string; window: ClaudeUsageWindow }) {
  return (
    <div className="claude-stat">
      <span className="claude-stat-label">{label}</span>
      <span className="claude-stat-value">{compact(totalTokens(w.tokens))}</span>
      <span className="claude-stat-sub">
        {w.requests.toLocaleString()} req · {money(w.costUsd)} API-equiv.
      </span>
    </div>
  );
}

// A bar per day across the window. Deliberately not a charting library — this
// is one number per day and a div each says it just as well.
function DayBars({ days }: { days: ClaudeUsageResult["days"] }) {
  const max = Math.max(...days.map((d) => d.costUsd), 0.01);
  return (
    <div className="claude-bars" role="img" aria-label="Daily cost, last 30 days">
      {days.map((d) => (
        <span
          key={d.date}
          className={`claude-bar ${d.costUsd > 0 ? "has-value" : ""}`}
          style={{ height: `${Math.max(2, (d.costUsd / max) * 100)}%` }}
          title={`${d.date} — ${money(d.costUsd)}`}
        />
      ))}
    </div>
  );
}

export function ClaudeBreakdown({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: ClaudeUsageBucket[];
  emptyLabel: string;
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        rows.map((row) => (
          <div className="row claude-breakdown-row" key={row.key}>
            <span className="name">{row.label}</span>
            {row.unpriced && (
              <span className="claude-unpriced" title="No published rate for this model — tokens counted, cost excluded">
                unpriced
              </span>
            )}
            <span className="status">{compact(totalTokens(row.tokens))} tok</span>
            <span className="claude-cost" title="API-equivalent value, not an amount billed">
              {row.unpriced ? "—" : money(row.costUsd)}
            </span>
          </div>
        ))
      )}
    </Panel>
  );
}

// The one genuinely useful thing the dollar number says to a subscriber: how
// much API-equivalent work the plan is returning. The plan price is printed
// inline rather than hidden in the multiple, so a stale price is obvious.
function ValueLine({ data }: { data: ClaudeUsageResult }) {
  const value = data.last30.costUsd;
  const plan = data.plan;
  if (!plan) return null;

  return (
    <p className="claude-value">
      <strong>{money(value)}</strong> of API-equivalent usage in 30 days
      {plan.monthlyUsd ? (
        <>
          {" "}
          — about <strong>{Math.round(value / plan.monthlyUsd)}×</strong> a ${plan.monthlyUsd}/mo{" "}
          {plan.label} plan.
        </>
      ) : (
        <> on the {plan.label} plan.</>
      )}
    </p>
  );
}

export default function ClaudeUsageWidget({ data }: ClaudeUsageWidgetProps) {
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Reading Claude Code transcripts…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else {
    const t = data.last30.tokens;
    const total = totalTokens(t);
    // Cache reads are almost always the overwhelming majority of tokens, and
    // that's the single most useful thing this panel can tell you.
    const cacheShare = total > 0 ? Math.round((t.cacheRead / total) * 100) : 0;

    body = (
      <>
        <div className="claude-stats">
          <WindowStat label="Today" window={data.today} />
          <WindowStat label="Last 7 days" window={data.last7} />
          <WindowStat label="Last 30 days" window={data.last30} />
        </div>

        <DayBars days={data.days} />

        <div className="claude-tokenline">
          <span>in {compact(t.input)}</span>
          <span>out {compact(t.output)}</span>
          <span>cache read {compact(t.cacheRead)} ({cacheShare}%)</span>
          <span>cache write {compact(t.cacheWrite5m + t.cacheWrite1h)}</span>
        </div>

        <ValueLine data={data} />

        <p className="claude-disclaimer">
          Dollar figures are what this usage would cost at Anthropic API list prices — a
          subscription doesn’t charge per token, so they measure value, not spend. There’s no
          local record of quota remaining, so this can’t show how much of a plan is used up.
          {data.unpricedModels.length > 0 && (
            <> Unpriced models present: {data.unpricedModels.join(", ")}.</>
          )}
        </p>
      </>
    );
  }

  return (
    <Panel
      title="Claude Code usage"
      headerRight={
        data?.ok ? <span className="claude-scan">scanned in {data.scanMs}ms</span> : undefined
      }
    >
      {body}
    </Panel>
  );
}
