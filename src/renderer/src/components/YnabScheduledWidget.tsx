import { Fragment } from "react";
import type { YnabScheduledResult, YnabScheduledTransaction } from "../../../shared/types";
import Panel from "./Panel";

interface YnabScheduledWidgetProps {
  data: YnabScheduledResult | null;
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

function groupByAccount(
  transactions: YnabScheduledTransaction[]
): [string, YnabScheduledTransaction[]][] {
  const groups = new Map<string, YnabScheduledTransaction[]>();
  for (const t of transactions) {
    const group = groups.get(t.accountName) ?? [];
    group.push(t);
    groups.set(t.accountName, group);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([account, group]) => [
      account,
      group.slice().sort((a, b) => a.dateNext.localeCompare(b.dateNext)),
    ]);
}

function ScheduledRow({ transaction }: { transaction: YnabScheduledTransaction }) {
  return (
    <tr>
      <td className="ynab-col-date">{formatDate(transaction.dateNext)}</td>
      <td className="ynab-col-payee">{transaction.payeeName ?? "(no payee)"}</td>
      <td className="ynab-col-frequency">{transaction.frequency}</td>
      <td className={`ynab-col-amount ynab-balance ${transaction.amount < 0 ? "negative" : ""}`}>
        {formatAmount(transaction.amount)}
      </td>
    </tr>
  );
}

export default function YnabScheduledWidget({ data }: YnabScheduledWidgetProps) {
  if (!data) {
    return (
      <Panel title="Scheduled Transactions">
        <p className="muted">Loading scheduled transactions…</p>
      </Panel>
    );
  }

  if (!data.ok) {
    return (
      <Panel title="Scheduled Transactions" headerRight={<span className="pip alert"></span>}>
        <p className="muted">{data.reason}. Add one in Settings under Integrations.</p>
      </Panel>
    );
  }

  if (data.transactions.length === 0) {
    return (
      <Panel title="Scheduled Transactions">
        <p className="muted">Nothing scheduled this month.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Scheduled Transactions">
      <table className="ynab-table">
        <thead>
          <tr>
            <th className="ynab-col-date">Date</th>
            <th className="ynab-col-payee">Payee</th>
            <th className="ynab-col-frequency">Frequency</th>
            <th className="ynab-col-amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {groupByAccount(data.transactions).map(([account, transactions]) => (
            <Fragment key={account}>
              <tr className="ynab-table-group-row">
                <td colSpan={4} className="ynab-table-group-title">
                  {account}
                </td>
              </tr>
              {transactions.map((t) => (
                <ScheduledRow key={t.id} transaction={t} />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
