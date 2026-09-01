import type { ReactNode } from "react";
import type {
  CodexQuotaWindow,
  CodexTokenTotals,
  CodexUsageBucket,
  CodexUsageResult,
  CodexUsageWindow,
} from "../../../shared/types";
import Panel from "./Panel";

interface CodexUsageWidgetProps {
  data: CodexUsageResult | null;
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function totalTokens(tokens: CodexTokenTotals): number {
  return tokens.input + tokens.output;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function until(timestamp: number): string {
  const minutes = Math.max(0, Math.ceil((timestamp - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function windowLabel(minutes: number): string {
  if (minutes % 10_080 === 0) return `${minutes / 10_080}w`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function WindowStat({ label, window }: { label: string; window: CodexUsageWindow }) {
  return (
    <div className="claude-stat">
      <span className="claude-stat-label">{label}</span>
      <span className="claude-stat-value">{compact(totalTokens(window.tokens))}</span>
      <span className="claude-stat-sub">{window.requests.toLocaleString()} model calls</span>
    </div>
  );
}

function DayBars({ days }: { days: CodexUsageResult["days"] }) {
  const max = Math.max(...days.map((day) => day.tokens), 1);
  return (
    <div className="claude-bars" role="img" aria-label="Daily Codex token usage, last 30 days">
      {days.map((day) => (
        <span
          key={day.date}
          className={`claude-bar ${day.tokens > 0 ? "has-value" : ""}`}
          style={{ height: `${Math.max(2, (day.tokens / max) * 100)}%` }}
          title={`${day.date} — ${day.tokens.toLocaleString()} tokens`}
        />
      ))}
    </div>
  );
}

function QuotaBar({ quota }: { quota: CodexQuotaWindow }) {
  const label = windowLabel(quota.windowMinutes);
  return (
    <div className={`codex-quota-window ${quota.stale ? "stale" : ""}`}>
      <div className="codex-quota-head">
        <span>{label} window</span>
        <span>{quota.stale ? "snapshot expired" : `${quota.usedPercent.toFixed(0)}% used`}</span>
      </div>
      <div
        className="codex-quota-track"
        role="progressbar"
        aria-label={`${label} Codex usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={quota.stale ? undefined : quota.usedPercent}
      >
        <span style={{ width: `${quota.stale ? 0 : Math.min(100, quota.usedPercent)}%` }} />
      </div>
      <span className="codex-quota-reset" title={new Date(quota.resetsAt).toLocaleString()}>
        {quota.stale ? "Run Codex to refresh this window" : `resets in ${until(quota.resetsAt)}`}
      </span>
    </div>
  );
}

function Quota({ data }: { data: CodexUsageResult }) {
  const quota = data.quota;
  if (!quota) {
    return <p className="codex-quota-empty">No local quota snapshot yet. Run Codex to record one.</p>;
  }
  const plan = quota.planType
    ? `${quota.planType.charAt(0).toUpperCase()}${quota.planType.slice(1)} plan`
    : "Codex subscription";
  const credits = quota.credits;
  return (
    <div className="codex-quota">
      <div className="codex-quota-titleline">
        <strong>{plan}</strong>
        <span>reported {relativeTime(quota.reportedAt)}</span>
      </div>
      <div className="codex-quota-grid">
        {quota.primary && <QuotaBar quota={quota.primary} />}
        {quota.secondary && <QuotaBar quota={quota.secondary} />}
      </div>
      {(credits?.unlimited || credits?.hasCredits) && (
        <p className="codex-credit">
          {credits.unlimited ? "Additional usage credits: unlimited" : `Credit balance: ${credits.balance ?? "available"}`}
        </p>
      )}
      {(quota.rateLimitReachedType || quota.spendControlReached) && (
        <p className="codex-limit-warning">
          {quota.spendControlReached
            ? "Codex spend control has been reached."
            : `Codex ${quota.rateLimitReachedType} limit has been reached.`}
        </p>
      )}
    </div>
  );
}

export function CodexBreakdown({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: CodexUsageBucket[];
  emptyLabel: string;
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        rows.map((row) => (
          <div className="row codex-breakdown-row" key={row.key}>
            <span className="name" title={row.label}>{row.label}</span>
            <span className="status">{row.requests.toLocaleString()} calls</span>
            <span className="codex-tokens">{compact(totalTokens(row.tokens))} tok</span>
          </div>
        ))
      )}
    </Panel>
  );
}

export default function CodexUsageWidget({ data }: CodexUsageWidgetProps) {
  let body: ReactNode;
  if (!data) {
    body = <p className="muted">Reading local Codex sessions…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else {
    const tokens = data.last30.tokens;
    const total = totalTokens(tokens);
    const cacheShare = total > 0 ? Math.round((tokens.cachedInput / total) * 100) : 0;
    body = (
      <>
        <Quota data={data} />
        <div className="codex-usage-divider" />
        <div className="claude-stats">
          <WindowStat label="Today" window={data.today} />
          <WindowStat label="Last 7 days" window={data.last7} />
          <WindowStat label="Last 30 days" window={data.last30} />
        </div>
        <DayBars days={data.days} />
        <div className="claude-tokenline">
          <span>in {compact(tokens.input)}</span>
          <span>out {compact(tokens.output)}</span>
          <span>cached {compact(tokens.cachedInput)} ({cacheShare}%)</span>
          {tokens.cacheWriteInput > 0 && <span>cache write {compact(tokens.cacheWriteInput)}</span>}
          <span>reasoning {compact(tokens.reasoningOutput)}</span>
        </div>
        <p className="claude-disclaimer">
          Tokens and quota come from local Codex records for this machine. Cached input is part of
          input and reasoning is part of output, so both are shown as breakdowns rather than added
          to the total. Quota is the latest snapshot Codex reported, not an API billing limit.
        </p>
      </>
    );
  }

  return (
    <Panel
      title="Codex subscription"
      headerRight={data?.ok ? <span className="claude-scan">scanned in {data.scanMs}ms</span> : undefined}
    >
      {body}
    </Panel>
  );
}

