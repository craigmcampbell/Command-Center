import type { ReactNode } from "react";
import type {
  RailwayUsageLineItem,
  RailwayUsageResult,
  RailwayWorkspaceUsage,
} from "../../../shared/types";
import Panel from "./Panel";

interface RailwayUsageWidgetProps {
  data: RailwayUsageResult | null;
}

function money(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function date(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function period(workspace: RailwayWorkspaceUsage): string {
  if (!workspace.billingPeriodStart && !workspace.billingPeriodEnd) return "No billing period";
  return `${date(workspace.billingPeriodStart)} – ${date(workspace.billingPeriodEnd)}`;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="openrouter-stat">
      <span className="openrouter-stat-label">{label}</span>
      <span className="openrouter-stat-value">{value}</span>
      {sub && <span className="openrouter-stat-sub">{sub}</span>}
    </div>
  );
}

function WorkspaceRow({ workspace }: { workspace: RailwayWorkspaceUsage }) {
  const hardLimit = workspace.usageLimit?.hardLimit;
  const limitPercent =
    hardLimit != null && hardLimit > 0
      ? Math.min(100, (workspace.currentUsageDollars / hardLimit) * 100)
      : null;

  return (
    <article className="railway-workspace">
      <div className="railway-workspace-head">
        <div>
          <h3>{workspace.name}</h3>
          <span>{period(workspace)}</span>
        </div>
        <div className="railway-workspace-cost">
          <strong>{money(workspace.currentUsageDollars)}</strong>
          <span>{money(workspace.estimatedBillDollars)} projected</span>
        </div>
      </div>
      <div className="railway-workspace-meta">
        <span>Available {money(workspace.creditBalance)}</span>
        <span>Cycle credit left {money(workspace.remainingUsageCreditBalance)}</span>
        <span>Applied {money(workspace.appliedCredits)}</span>
      </div>
      {limitPercent != null && (
        <div className="firecrawl-quota">
          <div className="firecrawl-quota-head">
            <span>{workspace.usageLimit?.isOverLimit ? "Over hard limit" : "Hard limit"}</span>
            <span>
              {money(workspace.currentUsageDollars)} / {money(hardLimit)}
            </span>
          </div>
          <div
            className="firecrawl-quota-track"
            role="progressbar"
            aria-label={`${workspace.name} hard usage limit`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={limitPercent}
          >
            <span style={{ width: `${limitPercent}%` }} />
          </div>
        </div>
      )}
      {workspace.reason && <p className="railway-warning">{workspace.reason}</p>}
    </article>
  );
}

function LineItems({ rows }: { rows: RailwayUsageLineItem[] }) {
  if (rows.length === 0) return <p className="muted">No metered usage this cycle.</p>;
  return (
    <div className="railway-line-items">
      <div className="railway-line-item railway-line-item-head">
        <span>Resource</span>
        <span>Current</span>
        <span>Projected</span>
      </div>
      {rows.map((row) => (
        <div className="railway-line-item" key={row.key}>
          <span>{row.label}</span>
          <span>{money(row.currentUsageDollars)}</span>
          <span>{money(row.estimatedUsageDollars)}</span>
        </div>
      ))}
    </div>
  );
}

export default function RailwayUsageWidget({ data }: RailwayUsageWidgetProps) {
  let body: ReactNode;

  if (!data) {
    body = <p className="muted">Loading Railway billing…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else {
    body = (
      <>
        <div className="railway-stats">
          <Stat
            label="Current usage"
            value={money(data.currentUsageDollars)}
            sub={`${data.workspaces.length} workspace${data.workspaces.length === 1 ? "" : "s"}`}
          />
          <Stat label="Projected bill" value={money(data.estimatedBillDollars)} sub="current cycles" />
          <Stat label="Available credits" value={money(data.creditBalance)} />
          <Stat label="Cycle credit left" value={money(data.remainingUsageCreditBalance)} />
          <Stat label="Applied this cycle" value={money(data.appliedCredits)} />
        </div>
        {data.reason && <p className="railway-warning">{data.reason}</p>}
        <div className="railway-section">
          <h3 className="railway-section-title">Workspaces</h3>
          {data.workspaces.length === 0 ? (
            <p className="muted">No Railway workspaces are accessible to this token.</p>
          ) : (
            <div className="railway-workspaces">
              {data.workspaces.map((workspace) => (
                <WorkspaceRow key={workspace.id} workspace={workspace} />
              ))}
            </div>
          )}
        </div>
        <div className="railway-section">
          <h3 className="railway-section-title">Metered resources</h3>
          <LineItems rows={data.lineItems} />
        </div>
        <p className="railway-footnote">
          Forecast uses Railway CLI rates · refreshed in {Math.round(data.scanMs)}ms
        </p>
      </>
    );
  }

  return <Panel title="Railway billing">{body}</Panel>;
}
