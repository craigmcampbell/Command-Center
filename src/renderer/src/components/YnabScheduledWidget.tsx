import type { YnabScheduledResult, YnabScheduledTransaction } from "../../../shared/types";
import Panel from "./Panel";

interface YnabScheduledWidgetProps {
  data: YnabScheduledResult | null;
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    <div className="row">
      <span className="name">{transaction.payeeName ?? "(no payee)"}</span>
      <span className="tag">
        {formatDate(transaction.dateNext)} · {transaction.frequency}
      </span>
      <span className={`tag ynab-balance ${transaction.amount < 0 ? "negative" : ""}`}>
        {formatAmount(transaction.amount)}
      </span>
    </div>
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
      {groupByAccount(data.transactions).map(([account, transactions]) => (
        <div className="todoist-group" key={account}>
          <h3 className="todoist-group-title">{account}</h3>
          {transactions.map((t) => (
            <ScheduledRow key={t.id} transaction={t} />
          ))}
        </div>
      ))}
    </Panel>
  );
}
