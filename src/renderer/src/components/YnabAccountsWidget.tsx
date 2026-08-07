import { Fragment, useState } from "react";
import type {
  YnabAccount,
  YnabAccountsResult,
  YnabScheduledResult,
  YnabScheduledTransaction,
} from "../../../shared/types";
import Panel from "./Panel";
import { IconEye, IconEyeOff } from "./icons";

interface YnabAccountsWidgetProps {
  accountsData: YnabAccountsResult | null;
  scheduledData: YnabScheduledResult | null;
  onChange: (data: YnabAccountsResult) => void;
}

type Tab = "accounts" | "scheduled";

function formatBalance(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
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

function typeLabel(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function groupByType(accounts: YnabAccount[]): [string, YnabAccount[]][] {
  const groups = new Map<string, YnabAccount[]>();
  for (const account of accounts) {
    const group = groups.get(account.type) ?? [];
    group.push(account);
    groups.set(account.type, group);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, group]) => [type, group.slice().sort((a, b) => a.name.localeCompare(b.name))]);
}

function groupScheduledByAccount(
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

function AccountRow({
  account,
  onToggleHidden,
}: {
  account: YnabAccount;
  onToggleHidden: (id: string) => void;
}) {
  return (
    <tr>
      <td className="ynab-col-name">{account.name}</td>
      <td className={`ynab-col-amount ynab-balance ${account.balance < 0 ? "negative" : ""}`}>
        {formatBalance(account.balance)}
      </td>
      <td className="ynab-col-hide">
        <button
          className="row-action"
          onClick={() => onToggleHidden(account.id)}
          title={account.hidden ? "Show account" : "Hide account"}
        >
          {account.hidden ? <IconEyeOff /> : <IconEye />}
        </button>
      </td>
    </tr>
  );
}

function AccountGroups({
  groups,
  onToggleHidden,
}: {
  groups: [string, YnabAccount[]][];
  onToggleHidden: (id: string) => void;
}) {
  return (
    <>
      {groups.map(([type, accounts]) => (
        <Fragment key={type}>
          <tr className="ynab-table-group-row">
            <td colSpan={3} className="ynab-table-group-title">
              {typeLabel(type)}
            </td>
          </tr>
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} onToggleHidden={onToggleHidden} />
          ))}
        </Fragment>
      ))}
    </>
  );
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

function AccountsBody({
  data,
  onToggleHidden,
}: {
  data: YnabAccountsResult;
  onToggleHidden: (id: string) => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const visible = data.accounts.filter((a) => !a.hidden);
  const hidden = data.accounts.filter((a) => a.hidden);

  return (
    <>
      {visible.length === 0 ? (
        <p className="muted">No accounts to show.</p>
      ) : (
        <table className="ynab-table">
          <thead>
            <tr>
              <th className="ynab-col-name">Name</th>
              <th className="ynab-col-amount">Balance</th>
              <th className="ynab-col-hide" aria-label="Hide" />
            </tr>
          </thead>
          <tbody>
            <AccountGroups groups={groupByType(visible)} onToggleHidden={onToggleHidden} />
          </tbody>
        </table>
      )}
      {hidden.length > 0 && (
        <div className="ynab-hidden-section">
          {showHidden ? (
            <table className="ynab-table">
              <tbody>
                <AccountGroups groups={groupByType(hidden)} onToggleHidden={onToggleHidden} />
              </tbody>
            </table>
          ) : (
            <button className="ynab-show-hidden" onClick={() => setShowHidden(true)}>
              {hidden.length} hidden — show
            </button>
          )}
          {showHidden && (
            <button className="ynab-show-hidden" onClick={() => setShowHidden(false)}>
              Hide again
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default function YnabAccountsWidget({
  accountsData,
  scheduledData,
  onChange,
}: YnabAccountsWidgetProps) {
  const [tab, setTab] = useState<Tab>("accounts");

  async function toggleHidden(id: string) {
    onChange(await window.api.ynab.toggleAccountHidden(id));
  }

  const headerRight = (
    <div className="scratchpad-toolbar">
      <div className="scratchpad-modes">
        <button
          type="button"
          className={`scratchpad-mode ${tab === "accounts" ? "active" : ""}`}
          onClick={() => setTab("accounts")}
        >
          Accounts
        </button>
        <button
          type="button"
          className={`scratchpad-mode ${tab === "scheduled" ? "active" : ""}`}
          onClick={() => setTab("scheduled")}
        >
          Scheduled
        </button>
      </div>
    </div>
  );

  let body;
  if (tab === "accounts") {
    if (!accountsData) {
      body = <p className="muted">Loading accounts…</p>;
    } else if (!accountsData.ok) {
      body = <p className="muted">{accountsData.reason}. Add one in Settings under Integrations.</p>;
    } else {
      body = <AccountsBody data={accountsData} onToggleHidden={toggleHidden} />;
    }
  } else {
    if (!scheduledData) {
      body = <p className="muted">Loading scheduled transactions…</p>;
    } else if (!scheduledData.ok) {
      body = <p className="muted">{scheduledData.reason}. Add one in Settings under Integrations.</p>;
    } else if (scheduledData.transactions.length === 0) {
      body = <p className="muted">Nothing scheduled this month.</p>;
    } else {
      body = (
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
            {groupScheduledByAccount(scheduledData.transactions).map(([account, transactions]) => (
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
      );
    }
  }

  return (
    <Panel title={tab === "accounts" ? "Accounts" : "Scheduled Transactions"} headerRight={headerRight}>
      {body}
    </Panel>
  );
}
