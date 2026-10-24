import { Fragment, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import type {
  YnabAccount,
  YnabAccountsResult,
  YnabCategoriesResult,
  YnabCategory,
  YnabPayee,
  YnabPayeesResult,
  YnabSplitPart,
  YnabTransaction,
  YnabUnapprovedResult,
} from "../../../shared/types";
import Panel from "./Panel";
import Select from "./Select";
import { IconCheck, IconChevronRight, IconExternal, IconPlus, IconRefresh, IconX } from "./icons";

interface YnabUnapprovedWidgetProps {
  data: YnabUnapprovedResult | null;
  categories: YnabCategoriesResult | null;
  payees: YnabPayeesResult | null;
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
            className="dropdown-menu"
            ref={dropdownRef}
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            {filtered.length === 0 ? (
              <div className="dropdown-empty">No matches</div>
            ) : (
              filtered.map(([group, cats]) => (
                <div key={group} className="ynab-category-group">
                  <div className="ynab-category-group-label">{group}</div>
                  {cats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`dropdown-option ${c.id === categoryId ? "selected" : ""}`}
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

// A payee combobox that still allows free text — unlike CategoryPicker, an
// unmatched typed name is a valid outcome (YNAB mints a new payee), not an
// error state, so onChange fires on every keystroke rather than only on
// selecting a list item.
function PayeePicker({
  payeeName,
  payeeId,
  payees,
  onChange,
  disabled,
}: {
  payeeName: string;
  payeeId: string | null;
  payees: YnabPayee[];
  onChange: (name: string, id: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function openDropdown() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) });
    setOpen(true);
  }

  // Same portal + outside-click/scroll-close mechanics as CategoryPicker —
  // rendered outside the panel's scrolling body, so a fixed-position rect
  // has to be invalidated by closing rather than tracked through a scroll.
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

  function handleSelect(p: YnabPayee) {
    setOpen(false);
    onChange(p.name, p.id);
  }

  const q = payeeName.trim().toLowerCase();
  const filtered = q ? payees.filter((p) => p.name.toLowerCase().includes(q)) : payees;

  return (
    <div className="ynab-category-picker">
      <input
        ref={inputRef}
        className="settings-input"
        placeholder="Payee"
        value={payeeName}
        onFocus={openDropdown}
        onChange={(e) => {
          onChange(e.target.value, null);
          if (!open) openDropdown();
        }}
        disabled={disabled}
      />
      {open &&
        rect &&
        filtered.length > 0 &&
        createPortal(
          <div
            className="dropdown-menu"
            ref={dropdownRef}
            style={{ top: rect.top, left: rect.left, width: rect.width }}
          >
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`dropdown-option ${p.id === payeeId ? "selected" : ""}`}
                onClick={() => handleSelect(p)}
              >
                {p.name}
              </button>
            ))}
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

function centsOf(text: string): number {
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

interface SplitLine {
  categoryId: string | null;
  categoryName: string | null;
  amountText: string;
  memo: string;
}

// Splits an existing transaction into category lines. Amounts are entered as
// positive figures and must add up to the transaction exactly, to the cent —
// the Save button stays off until they do, and main re-checks against YNAB's
// own copy before anything is sent. YNAB can't edit the lines of a split that
// already exists, so this only appears on plain transactions.
function SplitEditor({
  transaction,
  groupedCategories,
  onDone,
  onCancel,
}: {
  transaction: YnabTransaction;
  groupedCategories: [string, YnabCategory[]][];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [lines, setLines] = useState<SplitLine[]>([
    {
      categoryId: transaction.categoryId,
      categoryName: transaction.categoryName,
      amountText: "",
      memo: "",
    },
    { categoryId: null, categoryName: null, amountText: "", memo: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCents = Math.round(Math.abs(transaction.amount) * 100);
  const remaining = totalCents - lines.reduce((sum, l) => sum + centsOf(l.amountText), 0);
  const canSave =
    lines.length >= 2 &&
    remaining === 0 &&
    lines.every((l) => l.categoryId && centsOf(l.amountText) > 0);

  function update(i: number, patch: Partial<SplitLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    const parts: YnabSplitPart[] = lines.map((l) => ({
      categoryId: l.categoryId as string,
      amount: centsOf(l.amountText) / 100,
      memo: l.memo.trim() || undefined,
    }));
    const res = await window.api.ynab.splitTransaction(transaction.id, parts);
    if (res.ok) {
      await onDone();
    } else {
      setSaving(false);
      setError(res.reason ?? "Couldn't split that transaction.");
    }
  }

  return (
    <tr className="ynab-split-row">
      <td colSpan={6}>
        <div className="ynab-split">
          {lines.map((l, i) => (
            <div key={i} className="ynab-split-line">
              <CategoryPicker
                categoryId={l.categoryId}
                categoryName={l.categoryName}
                groupedCategories={groupedCategories}
                onSelect={(id, name) => update(i, { categoryId: id, categoryName: name })}
                disabled={saving}
              />
              <input
                className="settings-input ynab-split-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder={remaining > 0 ? (remaining / 100).toFixed(2) : "0.00"}
                value={l.amountText}
                onChange={(e) => update(i, { amountText: e.target.value })}
                disabled={saving}
              />
              <input
                className="ynab-memo-input"
                placeholder="Memo"
                value={l.memo}
                onChange={(e) => update(i, { memo: e.target.value })}
                disabled={saving}
              />
              <button
                type="button"
                className="row-action"
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                disabled={saving || lines.length <= 2}
                title="Remove line"
              >
                <IconX />
              </button>
            </div>
          ))}
          <div className="ynab-split-footer">
            <button
              type="button"
              className="row-action"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  { categoryId: null, categoryName: null, amountText: "", memo: "" },
                ])
              }
              disabled={saving}
            >
              <IconPlus /> Add line
            </button>
            <span className={`muted ynab-split-remaining ${remaining === 0 ? "" : "off"}`}>
              {remaining === 0
                ? "Adds up"
                : remaining > 0
                  ? `${formatAmount(remaining / 100)} left to assign`
                  : `${formatAmount(-remaining / 100)} over`}
            </span>
            <div className="ynab-add-form-actions">
              <button type="button" onClick={handleSave} disabled={!canSave || saving}>
                {saving ? "Splitting…" : "Split"}
              </button>
              <button type="button" onClick={onCancel} aria-label="Cancel split" disabled={saving}>
                <IconX />
              </button>
            </div>
          </div>
          {error && <span className="muted ynab-add-form-error">{error}</span>}
        </div>
      </td>
    </tr>
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
  const [splitting, setSplitting] = useState(false);
  // A split has no category of its own, but is as ready to approve as a
  // categorised row — each of its lines already has one.
  const canApprove = !!transaction.categoryId || !!transaction.isSplit;

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
    <>
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
        <td className="ynab-col-payee">
          <span
            className="ynab-payee-link"
            onClick={() => window.api.openUrl(transaction.ynabUrl)}
            title="Open account in YNAB"
          >
            {transaction.payeeName ?? "(no payee)"}
            <IconExternal className="external-icon" />
          </span>
        </td>
        <td className="ynab-col-category">
          {transaction.isSplit ? (
            <span className="tag" title="Edit the lines of a split in YNAB">
              Split
            </span>
          ) : groupedCategories.length > 0 ? (
            <div className="ynab-category-with-split">
              <CategoryPicker
                categoryId={transaction.categoryId}
                categoryName={transaction.categoryName}
                groupedCategories={groupedCategories}
                onSelect={handleCategorySelect}
                disabled={categorySaving}
              />
              <button
                type="button"
                className="row-action"
                onClick={() => setSplitting((v) => !v)}
                title={splitting ? "Cancel split" : "Split across categories"}
              >
                {splitting ? <IconX /> : "Split"}
              </button>
            </div>
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
      {splitting && !transaction.isSplit && (
        <SplitEditor
          transaction={transaction}
          groupedCategories={groupedCategories}
          onDone={async () => {
            setSplitting(false);
            await onRefresh();
          }}
          onCancel={() => setSplitting(false)}
        />
      )}
    </>
  );
}

function NewTransactionForm({
  accounts,
  groupedCategories,
  payees,
  onCreated,
  onCancel,
}: {
  accounts: YnabAccount[];
  groupedCategories: [string, YnabCategory[]][];
  payees: YnabPayee[];
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayIso());
  const [payeeName, setPayeeName] = useState("");
  const [payeeId, setPayeeId] = useState<string | null>(null);
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
      payeeId: payeeId ?? undefined,
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
      <Select
        value={accountId}
        onChange={setAccountId}
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
      />
      <input
        type="date"
        className="settings-input"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <PayeePicker
        payeeName={payeeName}
        payeeId={payeeId}
        payees={payees}
        onChange={(name, id) => {
          setPayeeName(name);
          setPayeeId(id);
        }}
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
  payees,
  accounts,
  onRefresh,
}: YnabUnapprovedWidgetProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // A transient line beside the buttons rather than a modal: the outcome of an
  // import or bulk approve is one short sentence, and the list below updates.
  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 6000);
  }

  async function handleImport() {
    setImporting(true);
    const res = await window.api.ynab.importTransactions();
    setImporting(false);
    if (!res.ok) {
      flash(res.reason ?? "Import failed");
      return;
    }
    flash(res.imported === 0 ? "Nothing new to import" : `Imported ${res.imported}`);
    await onRefresh();
  }

  // Only rows that are ready — categorised, or a split — are offered. The same
  // rule as the per-row check, so "approve all" never does something the row
  // buttons would refuse.
  const approvable = data?.ok
    ? data.transactions.filter((t) => !!t.categoryId || !!t.isSplit)
    : [];
  const uncategorised = data?.ok ? data.transactions.length - approvable.length : 0;

  async function handleApproveAll() {
    setApprovingAll(true);
    const res = await window.api.ynab.approveTransactions(approvable.map((t) => t.id));
    setApprovingAll(false);
    setConfirmingApprove(false);
    flash(
      res.ok
        ? `Approved ${res.approved}`
        : `Approved ${res.approved} of ${approvable.length}: ${res.reason ?? "failed"}`
    );
    await onRefresh();
  }

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
  const payeeList = payees?.ok ? payees.payees : [];

  const headerRight = (
    <div className="ynab-header-actions">
      {notice && <span className="muted ynab-notice">{notice}</span>}
      {data?.ok && <span className="pip live"></span>}
      {confirmingApprove ? (
        <>
          <button type="button" onClick={handleApproveAll} disabled={approvingAll}>
            {approvingAll ? "Approving…" : `Approve ${approvable.length}?`}
          </button>
          <button
            type="button"
            className="row-action"
            onClick={() => setConfirmingApprove(false)}
            disabled={approvingAll}
            aria-label="Cancel"
          >
            <IconX />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="row-action"
          onClick={() => setConfirmingApprove(true)}
          disabled={approvable.length === 0}
          title={
            uncategorised > 0
              ? `Approve everything with a category (${uncategorised} still need one)`
              : "Approve everything"
          }
        >
          <IconCheck /> Approve all
        </button>
      )}
      <button
        type="button"
        className="row-action"
        onClick={handleImport}
        disabled={importing}
        title="Ask YNAB to import from your linked banks"
      >
        <IconRefresh /> {importing ? "Importing…" : "Import"}
      </button>
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
          payees={payeeList}
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
