import { Fragment, useState } from "react";
import type { YnabAccount, YnabAccountsResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconEye, IconEyeOff } from "./icons";

interface YnabAccountsWidgetProps {
  data: YnabAccountsResult | null;
  onChange: (data: YnabAccountsResult) => void;
}

function formatBalance(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
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

export default function YnabAccountsWidget({ data, onChange }: YnabAccountsWidgetProps) {
  const [showHidden, setShowHidden] = useState(false);

  async function toggleHidden(id: string) {
    onChange(await window.api.ynab.toggleAccountHidden(id));
  }

  if (!data) {
    return (
      <Panel title="Accounts">
        <p className="muted">Loading accounts…</p>
      </Panel>
    );
  }

  if (!data.ok) {
    return (
      <Panel title="Accounts" headerRight={<span className="pip alert"></span>}>
        <p className="muted">{data.reason}. Add one in Settings under Integrations.</p>
      </Panel>
    );
  }

  const visible = data.accounts.filter((a) => !a.hidden);
  const hidden = data.accounts.filter((a) => a.hidden);

  return (
    <Panel title="Accounts">
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
            <AccountGroups groups={groupByType(visible)} onToggleHidden={toggleHidden} />
          </tbody>
        </table>
      )}
      {hidden.length > 0 && (
        <div className="ynab-hidden-section">
          {showHidden ? (
            <table className="ynab-table">
              <tbody>
                <AccountGroups groups={groupByType(hidden)} onToggleHidden={toggleHidden} />
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
    </Panel>
  );
}
