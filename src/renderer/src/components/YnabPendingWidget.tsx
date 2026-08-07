import { Fragment, useState } from "react";
import type { YnabPendingResult, YnabTransaction } from "../../../shared/types";
import Panel from "./Panel";
import { IconCheck, IconChevronRight } from "./icons";

interface YnabPendingWidgetProps {
  data: YnabPendingResult | null;
  onRefresh: () => Promise<void>;
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Parsing "YYYY-MM-DD" alone is read as UTC midnight, which formats a day
// early in negative-UTC-offset zones — pin it to local noon instead.
function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function groupByAccount(transactions: YnabTransaction[]): [string, YnabTransaction[]][] {
  const groups = new Map<string, YnabTransaction[]>();
  for (const t of transactions) {
    const group = groups.get(t.accountName) ?? [];
    group.push(t);
    groups.set(t.accountName, group);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([account, group]) => [account, group.slice().sort((a, b) => a.date.localeCompare(b.date))]);
}

function PendingRow({
  transaction,
  onRefresh,
}: {
  transaction: YnabTransaction;
  onRefresh: () => Promise<void>;
}) {
  const [clearing, setClearing] = useState(false);

  async function handleClear() {
    setClearing(true);
    const res = await window.api.ynab.clearTransaction(transaction.id);
    if (res.ok) {
      await onRefresh();
    } else {
      setClearing(false);
    }
  }

  return (
    <tr>
      <td className="ynab-col-approve">
        <button
          className="check running"
          disabled={clearing}
          onClick={handleClear}
          title="Mark cleared"
        >
          <IconCheck className="check-icon" />
        </button>
      </td>
      <td className="ynab-col-date">{formatDate(transaction.date)}</td>
      <td className="ynab-col-payee">{transaction.payeeName ?? "(no payee)"}</td>
      <td className="ynab-col-category">
        <span className="tag">{transaction.categoryName ?? "Uncategorized"}</span>
      </td>
      <td className="ynab-col-memo">{transaction.memo ?? ""}</td>
      <td className={`ynab-col-amount ynab-balance ${transaction.amount < 0 ? "negative" : ""}`}>
        {formatAmount(transaction.amount)}
      </td>
    </tr>
  );
}

export default function YnabPendingWidget({ data, onRefresh }: YnabPendingWidgetProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(account: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });
  }

  let body;
  if (!data) {
    body = <p className="muted">Loading transactions…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}. Add one in Settings under Integrations.</p>;
  } else if (data.transactions.length === 0) {
    body = <p className="muted">Nothing pending.</p>;
  } else {
    body = (
      <table className="ynab-table">
        <thead>
          <tr>
            <th className="ynab-col-approve" aria-label="Clear" />
            <th className="ynab-col-date">Date</th>
            <th className="ynab-col-payee">Payee</th>
            <th className="ynab-col-category">Category</th>
            <th className="ynab-col-memo">Memo</th>
            <th className="ynab-col-amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {groupByAccount(data.transactions).map(([account, transactions]) => {
            const collapsed = collapsedGroups.has(account);
            return (
              <Fragment key={account}>
                <tr className="ynab-table-group-row" onClick={() => toggleGroup(account)}>
                  <td colSpan={6} className="ynab-table-group-title">
                    <span className="ynab-table-group-title-inner">
                      <IconChevronRight
                        className={`ynab-group-chevron ${collapsed ? "" : "expanded"}`}
                      />
                      {account}
                      <span className="ynab-group-count">{transactions.length}</span>
                    </span>
                  </td>
                </tr>
                {!collapsed &&
                  transactions.map((t) => (
                    <PendingRow key={t.id} transaction={t} onRefresh={onRefresh} />
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <Panel title="Pending Transactions" headerRight={data?.ok && <span className="pip live"></span>}>
      {body}
    </Panel>
  );
}
