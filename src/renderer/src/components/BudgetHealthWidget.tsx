import { Fragment, useEffect, useState } from "react";
import type { YnabMonthCategory, YnabMonthResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconChevronRight } from "./icons";

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

function CategoryRow({ category }: { category: YnabMonthCategory }) {
  return (
    <tr>
      <td className="ynab-col-name">{category.name}</td>
      <td className="ynab-col-amount">{formatAmount(category.budgeted)}</td>
      <td className="ynab-col-amount">{formatAmount(category.activity)}</td>
      <td className={`ynab-col-amount ynab-balance ${category.balance < 0 ? "negative" : ""}`}>
        {formatAmount(category.balance)}
      </td>
    </tr>
  );
}

export default function BudgetHealthWidget({ data }: BudgetHealthWidgetProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(loadCollapsedGroups);

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
              <th className="ynab-col-amount">Balance</th>
            </tr>
          </thead>
          <tbody>
            {groupByGroupName(data.categories).map(([group, categories]) => {
              const collapsed = collapsedGroups.has(group);
              return (
                <Fragment key={group}>
                  <tr className="ynab-table-group-row" onClick={() => toggleGroup(group)}>
                    <td colSpan={4} className="ynab-table-group-title">
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

  return <Panel title="Budget Health">{body}</Panel>;
}
