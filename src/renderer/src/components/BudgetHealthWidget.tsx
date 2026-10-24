import { Fragment, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { YnabMonthCategory, YnabMonthResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconChevronRight, IconExpand, IconX } from "./icons";

interface BudgetHealthWidgetProps {
  data: YnabMonthResult | null;
}

// Collapsed group state is UI-only (not app config), so it's kept in
// localStorage rather than round-tripped through the settings DB — same
// tier as window chrome, not user data. localStorage survives app restarts
// because it's scoped to this window's persistent partition, unlike plain
// React state.
const COLLAPSED_GROUPS_KEY = "budgetHealth.collapsedGroups";

function loadCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Preserves the service's own ordering (budget's group order, alpha by name
// within each group) rather than re-sorting groups alphabetically — same
// convention as YnabUnapprovedWidget's groupCategoriesByGroup.
function groupByGroupName(categories: YnabMonthCategory[]): [string, YnabMonthCategory[]][] {
  const groups = new Map<string, YnabMonthCategory[]>();
  for (const c of categories) {
    const group = groups.get(c.groupName) ?? [];
    group.push(c);
    groups.set(c.groupName, group);
  }
  return Array.from(groups.entries());
}

// YNAB reports spending as negative activity. Refunds make it positive, which
// counts as nothing spent rather than a negative bar.
function spentOf(c: { activity: number }): number {
  return Math.max(0, -c.activity);
}

// Spent this month as a share of what was budgeted this month — deliberately
// not of the balance, which carries rollover from earlier months and would make
// a category that coasts on last month's surplus look permanently "under".
// Null when nothing is budgeted and nothing spent: there's no ratio to draw.
function spentRatio(c: { budgeted: number; activity: number }): number | null {
  const spent = spentOf(c);
  if (c.budgeted <= 0) return spent > 0 ? Infinity : null;
  return spent / c.budgeted;
}

function SpentBar({ category }: { category: YnabMonthCategory }) {
  const ratio = spentRatio(category);
  if (ratio === null) return <span className="muted">—</span>;
  const tone = ratio > 1 ? "over" : ratio >= 0.85 ? "near" : "ok";
  const pct = Number.isFinite(ratio) ? Math.round(ratio * 100) : null;
  return (
    <span
      className="budget-spent"
      title={`${formatAmount(spentOf(category))} spent of ${formatAmount(category.budgeted)} budgeted`}
    >
      <span className="budget-spent-track">
        <span
          className={`budget-spent-fill ${tone}`}
          style={{ width: `${Math.min(100, Number.isFinite(ratio) ? ratio * 100 : 100)}%` }}
        />
      </span>
      <span className="budget-spent-pct">{pct === null ? "unbudgeted" : `${pct}%`}</span>
    </span>
  );
}

function CategoryRow({ category }: { category: YnabMonthCategory }) {
  return (
    <tr>
      <td className="ynab-col-name">{category.name}</td>
      <td className="ynab-col-amount">{formatAmount(category.budgeted)}</td>
      <td className="ynab-col-amount">{formatAmount(category.activity)}</td>
      <td className="ynab-col-spent">
        <SpentBar category={category} />
      </td>
      <td className={`ynab-col-amount ynab-balance ${category.balance < 0 ? "negative" : ""}`}>
        {formatAmount(category.balance)}
      </td>
    </tr>
  );
}

export default function BudgetHealthWidget({ data }: BudgetHealthWidgetProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(loadCollapsedGroups);
  const [expanded, setExpanded] = useState(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(Array.from(collapsedGroups)));
  }, [collapsedGroups]);

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  let body;
  if (!data) {
    body = <p className="muted">Loading budget…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}. Add one in Settings under Integrations.</p>;
  } else if (data.categories.length === 0) {
    body = <p className="muted">No categories to show.</p>;
  } else {
    const totalSpent = data.categories.reduce((sum, c) => sum + spentOf(c), 0);
    const totalBudgeted = data.categories.reduce((sum, c) => sum + Math.max(0, c.budgeted), 0);
    body = (
      <>
        <div className="budget-health-stats">
          <div className="budget-health-stat">
            <span className="budget-health-stat-label">To Be Budgeted</span>
            <span
              className={`budget-health-stat-value ${data.toBeBudgeted < 0 ? "ynab-balance negative" : ""}`}
            >
              {formatAmount(data.toBeBudgeted)}
            </span>
          </div>
          <div className="budget-health-stat">
            <span className="budget-health-stat-label">Spent this month</span>
            <span className="budget-health-stat-value">
              {formatAmount(totalSpent)} of {formatAmount(totalBudgeted)}
            </span>
          </div>
          <div className="budget-health-stat">
            <span className="budget-health-stat-label">Age of Money</span>
            <span className="budget-health-stat-value">
              {data.ageOfMoney == null ? "—" : `${data.ageOfMoney} days`}
            </span>
          </div>
        </div>
        <table className="ynab-table">
          <thead>
            <tr>
              <th className="ynab-col-name">Category</th>
              <th className="ynab-col-amount">Budgeted</th>
              <th className="ynab-col-amount">Activity</th>
              <th className="ynab-col-spent">Spent vs budget</th>
              <th className="ynab-col-amount">Balance</th>
            </tr>
          </thead>
          <tbody>
            {groupByGroupName(data.categories).map(([group, categories]) => {
              const collapsed = collapsedGroups.has(group);
              return (
                <Fragment key={group}>
                  <tr className="ynab-table-group-row" onClick={() => toggleGroup(group)}>
                    <td colSpan={5} className="ynab-table-group-title">
                      <span className="ynab-table-group-title-inner">
                        <IconChevronRight
                          className={`ynab-group-chevron ${collapsed ? "" : "expanded"}`}
                        />
                        {group}
                        <span className="ynab-group-count">{categories.length}</span>
                      </span>
                    </td>
                  </tr>
                  {!collapsed && categories.map((c) => <CategoryRow key={c.id} category={c} />)}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }

  const expandable = Boolean(data?.ok && data.categories.length > 0);

  return (
    <>
      <Panel
        title="Budget Health"
        headerRight={
          expandable ? (
            <button
              type="button"
              className="md-expand-btn"
              onClick={() => setExpanded(true)}
              title="Expand"
              aria-label="Expand"
            >
              <IconExpand />
            </button>
          ) : undefined
        }
      >
        {body}
      </Panel>
      {expanded && (
        <BudgetExpandModal onClose={closeExpanded}>{body}</BudgetExpandModal>
      )}
    </>
  );
}

// Full-window view of the same table, in the same scrim+panel as
// MarkdownExpandModal. It is handed the already-built body rather than
// rebuilding it, so group collapse state is shared with the inline widget.
function BudgetExpandModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="settings-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="md-expand-panel" role="dialog" aria-modal="true" aria-label="Budget Health">
        <div className="settings-head">
          <h2>Budget Health</h2>
          <button className="settings-close" onClick={onClose} title="Close">
            <IconX />
          </button>
        </div>
        <div className="budget-expand-body">{children}</div>
      </div>
    </div>
  );
}
