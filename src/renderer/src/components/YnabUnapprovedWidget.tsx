import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  YnabCategoriesResult,
  YnabCategory,
  YnabTransaction,
  YnabUnapprovedResult,
} from "../../../shared/types";
import Panel from "./Panel";
import { IconCheck } from "./icons";

interface YnabUnapprovedWidgetProps {
  data: YnabUnapprovedResult | null;
  categories: YnabCategoriesResult | null;
  onRefresh: () => Promise<void>;
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

// Preserves the service's own ordering (budget's group order, alpha by name
// within each group) rather than re-sorting groups alphabetically.
function groupCategoriesByGroup(categories: YnabCategory[]): [string, YnabCategory[]][] {
  const groups = new Map<string, YnabCategory[]>();
  for (const c of categories) {
    const group = groups.get(c.groupName) ?? [];
    group.push(c);
    groups.set(c.groupName, group);
  }
  return Array.from(groups.entries());
}

function CategoryPicker({
  transactionId,
  categoryId,
  categoryName,
  groupedCategories,
  onAssigned,
}: {
  transactionId: string;
  categoryId: string | null;
  categoryName: string | null;
  groupedCategories: [string, YnabCategory[]][];
  onAssigned: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function openDropdown() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) });
    setQuery("");
    setOpen(true);
  }

  // Rendered via a portal (so it isn't clipped by the panel's scrolling
  // body), so "outside click" has to check both the input and the portaled
  // dropdown, and a scroll anywhere invalidates the fixed-position rect —
  // simplest to just close rather than track repositioning.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (inputRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  async function handleSelect(id: string) {
    setOpen(false);
    setSaving(true);
    const res = await window.api.ynab.setTransactionCategory(transactionId, id);
    if (res.ok) {
      await onAssigned();
    } else {
      setSaving(false);
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = groupedCategories
    .map(([group, cats]) => [group, q ? cats.filter((c) => c.name.toLowerCase().includes(q)) : cats] as [
      string,
      YnabCategory[],
    ])
    .filter(([, cats]) => cats.length > 0);

  return (
    <div className="ynab-category-picker">
      <input
        ref={inputRef}
        className="ynab-category-input"
        value={open ? query : categoryName ?? "Uncategorized"}
        onFocus={openDropdown}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search categories…"
        disabled={saving}
      />
      {open &&
        rect &&
        createPortal(
          <div
            className="ynab-category-dropdown"
            ref={dropdownRef}
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            {filtered.length === 0 ? (
              <div className="ynab-category-empty">No matches</div>
            ) : (
              filtered.map(([group, cats]) => (
                <div key={group} className="ynab-category-group">
                  <div className="ynab-category-group-label">{group}</div>
                  {cats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`ynab-category-option ${c.id === categoryId ? "selected" : ""}`}
                      onClick={() => handleSelect(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

function TransactionRow({
  transaction,
  groupedCategories,
  onRefresh,
}: {
  transaction: YnabTransaction;
  groupedCategories: [string, YnabCategory[]][];
  onRefresh: () => Promise<void>;
}) {
  const [approving, setApproving] = useState(false);
  const canApprove = !!transaction.categoryId;

  async function handleApprove() {
    setApproving(true);
    const res = await window.api.ynab.approveTransaction(transaction.id);
    if (res.ok) {
      await onRefresh();
    } else {
      setApproving(false);
    }
  }

  return (
    <tr>
      <td className="ynab-col-approve">
        <button
          className="check running"
          disabled={approving || !canApprove}
          onClick={handleApprove}
          title={canApprove ? "Approve" : "Assign a category first"}
        >
          <IconCheck className="check-icon" />
        </button>
      </td>
      <td className="ynab-col-date">{formatDate(transaction.date)}</td>
      <td className="ynab-col-payee">{transaction.payeeName ?? "(no payee)"}</td>
      <td className="ynab-col-category">
        {groupedCategories.length > 0 ? (
          <CategoryPicker
            transactionId={transaction.id}
            categoryId={transaction.categoryId}
            categoryName={transaction.categoryName}
            groupedCategories={groupedCategories}
            onAssigned={onRefresh}
          />
        ) : (
          <span className="tag">{transaction.categoryName ?? "Uncategorized"}</span>
        )}
      </td>
      <td className="ynab-col-memo">{transaction.memo ?? ""}</td>
      <td className={`ynab-col-amount ynab-balance ${transaction.amount < 0 ? "negative" : ""}`}>
        {formatAmount(transaction.amount)}
      </td>
    </tr>
  );
}

export default function YnabUnapprovedWidget({
  data,
  categories,
  onRefresh,
}: YnabUnapprovedWidgetProps) {
  if (!data) {
    return (
      <Panel title="Unapproved Transactions">
        <p className="muted">Loading transactions…</p>
      </Panel>
    );
  }

  if (!data.ok) {
    return (
      <Panel title="Unapproved Transactions" headerRight={<span className="pip alert"></span>}>
        <p className="muted">{data.reason}. Add one in Settings under Integrations.</p>
      </Panel>
    );
  }

  if (data.transactions.length === 0) {
    return (
      <Panel title="Unapproved Transactions">
        <p className="muted">Nothing waiting on approval.</p>
      </Panel>
    );
  }

  const groupedCategories =
    categories?.ok ? groupCategoriesByGroup(categories.categories) : [];

  return (
    <Panel title="Unapproved Transactions" headerRight={<span className="pip live"></span>}>
      <table className="ynab-table">
        <thead>
          <tr>
            <th className="ynab-col-approve" aria-label="Approve" />
            <th className="ynab-col-date">Date</th>
            <th className="ynab-col-payee">Payee</th>
            <th className="ynab-col-category">Category</th>
            <th className="ynab-col-memo">Memo</th>
            <th className="ynab-col-amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {groupByAccount(data.transactions).map(([account, transactions]) => (
            <Fragment key={account}>
              <tr className="ynab-table-group-row">
                <td colSpan={6} className="ynab-table-group-title">
                  {account}
                </td>
              </tr>
              {transactions.map((t) => (
                <TransactionRow
                  key={t.id}
                  transaction={t}
                  groupedCategories={groupedCategories}
                  onRefresh={onRefresh}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
