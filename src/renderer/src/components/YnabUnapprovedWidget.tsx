import { Fragment, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import type {
  YnabAccount,
  YnabAccountsResult,
  YnabCategoriesResult,
  YnabCategory,
  YnabTransaction,
  YnabUnapprovedResult,
} from "../../../shared/types";
import Panel from "./Panel";
import { IconCheck, IconChevronRight, IconPlus, IconX } from "./icons";

interface YnabUnapprovedWidgetProps {
  data: YnabUnapprovedResult | null;
  categories: YnabCategoriesResult | null;
  accounts: YnabAccountsResult | null;
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

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

// Pure "pick from a grouped, filterable list" UI — what happens with the
// pick (persist immediately vs. hold in a draft form) is up to the caller
// via onSelect, so this can back both an existing transaction's category
// cell and the new-transaction form's category field.
function CategoryPicker({
  categoryId,
  categoryName,
  groupedCategories,
  onSelect,
  disabled,
}: {
  categoryId: string | null;
  categoryName: string | null;
  groupedCategories: [string, YnabCategory[]][];
  onSelect: (id: string, name: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  async function handleSelect(c: YnabCategory) {
    setOpen(false);
    await onSelect(c.id, c.name);
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
        disabled={disabled}
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
                      onClick={() => handleSelect(c)}
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

function MemoCell({
  transaction,
  onRefresh,
}: {
  transaction: YnabTransaction;
  onRefresh: () => Promise<void>;
}) {
  const [value, setValue] = useState(transaction.memo ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(transaction.memo ?? ""), [transaction.memo]);

  async function handleBlur() {
    const current = transaction.memo ?? "";
    if (value === current) return;
    setSaving(true);
    const res = await window.api.ynab.setTransactionMemo(transaction.id, value);
    if (res.ok) {
      await onRefresh();
    } else {
      setSaving(false);
    }
  }

  return (
    <input
      className="ynab-memo-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      placeholder="Add memo…"
      disabled={saving}
    />
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
  const [categorySaving, setCategorySaving] = useState(false);
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

  async function handleCategorySelect(id: string) {
    setCategorySaving(true);
    const res = await window.api.ynab.setTransactionCategory(transaction.id, id);
    if (res.ok) {
      await onRefresh();
    } else {
      setCategorySaving(false);
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
            categoryId={transaction.categoryId}
            categoryName={transaction.categoryName}
            groupedCategories={groupedCategories}
            onSelect={handleCategorySelect}
            disabled={categorySaving}
          />
        ) : (
          <span className="tag">{transaction.categoryName ?? "Uncategorized"}</span>
        )}
      </td>
      <td className="ynab-col-memo">
        <MemoCell transaction={transaction} onRefresh={onRefresh} />
      </td>
      <td className={`ynab-col-amount ynab-balance ${transaction.amount < 0 ? "negative" : ""}`}>
        {formatAmount(transaction.amount)}
      </td>
    </tr>
  );
}

function NewTransactionForm({
  accounts,
  groupedCategories,
  onCreated,
  onCancel,
}: {
  accounts: YnabAccount[];
  groupedCategories: [string, YnabCategory[]][];
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayIso());
  const [payeeName, setPayeeName] = useState("");
  const [outflow, setOutflow] = useState(true);
  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const amountValue = Number(amountText);
  const canSubmit =
    !!accountId && !!date && amountText.trim() !== "" && !Number.isNaN(amountValue) && amountValue !== 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(false);
    const signedAmount = outflow ? -Math.abs(amountValue) : Math.abs(amountValue);
    const res = await window.api.ynab.createTransaction({
      accountId,
      date,
      amount: signedAmount,
      payeeName: payeeName.trim() || undefined,
      categoryId: categoryId ?? undefined,
      memo: memo.trim() || undefined,
    });
    setSaving(false);
    if (res.ok) {
      await onCreated();
    } else {
      setError(true);
    }
  }

  return (
    <form className="ynab-add-form" onSubmit={handleSubmit}>
      <select
        className="settings-input"
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input
        type="date"
        className="settings-input"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <input
        className="settings-input"
        placeholder="Payee"
        value={payeeName}
        onChange={(e) => setPayeeName(e.target.value)}
      />
      <div className="ynab-amount-group">
        <button
          type="button"
          className={`ynab-flow-toggle ${outflow ? "active" : ""}`}
          onClick={() => setOutflow(true)}
          title="Outflow"
        >
          −
        </button>
        <button
          type="button"
          className={`ynab-flow-toggle ${!outflow ? "active" : ""}`}
          onClick={() => setOutflow(false)}
          title="Inflow"
        >
          +
        </button>
        <input
          className="settings-input"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </div>
      {groupedCategories.length > 0 && (
        <CategoryPicker
          categoryId={categoryId}
          categoryName={categoryName}
          groupedCategories={groupedCategories}
          onSelect={(id, name) => {
            setCategoryId(id);
            setCategoryName(name);
          }}
        />
      )}
      <input
        className="settings-input"
        placeholder="Memo (optional)"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
      />
      <div className="ynab-add-form-actions">
        <button type="submit" disabled={!canSubmit || saving}>
          {saving ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={onCancel} aria-label="Cancel">
          <IconX />
        </button>
      </div>
      {error && <span className="muted ynab-add-form-error">Couldn't add that transaction.</span>}
    </form>
  );
}

export default function YnabUnapprovedWidget({
  data,
  categories,
  accounts,
  onRefresh,
}: YnabUnapprovedWidgetProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  function toggleGroup(account: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });
  }

  const groupedCategories = categories?.ok ? groupCategoriesByGroup(categories.categories) : [];
  const accountList = accounts?.ok ? accounts.accounts : [];

  const headerRight = (
    <div className="ynab-header-actions">
      {data?.ok && <span className="pip live"></span>}
      <button
        type="button"
        className="row-action"
        onClick={() => setAdding((v) => !v)}
        title={adding ? "Cancel" : "Add transaction"}
        disabled={accountList.length === 0}
      >
        {adding ? <IconX /> : <IconPlus />}
      </button>
    </div>
  );

  let body;
  if (!data) {
    body = <p className="muted">Loading transactions…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}. Add one in Settings under Integrations.</p>;
  } else if (data.transactions.length === 0) {
    body = <p className="muted">Nothing waiting on approval.</p>;
  } else {
    body = (
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
                    <TransactionRow
                      key={t.id}
                      transaction={t}
                      groupedCategories={groupedCategories}
                      onRefresh={onRefresh}
                    />
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <Panel title="Unapproved Transactions" headerRight={headerRight}>
      {adding && (
        <NewTransactionForm
          accounts={accountList}
          groupedCategories={groupedCategories}
          onCreated={async () => {
            setAdding(false);
            await onRefresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {body}
    </Panel>
  );
}
