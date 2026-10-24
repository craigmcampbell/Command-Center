import { useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import type {
  BillItem,
  CardItem,
  YnabAccount,
  YnabAccountHistoryResult,
  YnabAccountsResult,
} from "../../../shared/types";
import Panel from "./Panel";
import Select from "./Select";
import { IconCheck, IconNote, IconPencil, IconPlus, IconTrash, IconX } from "./icons";

interface BillsWidgetProps {
  bills: BillItem[];
  onChange: (bills: BillItem[]) => void;
  cards: CardItem[];
  onCardsChange: (cards: CardItem[]) => void;
  ynabAccounts: YnabAccountsResult | null;
}

type Tab = "bills" | "cards" | "utilization";

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatApr(n: number): string {
  return `${n}%`;
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

function BillFields({
  label,
  dueDay,
  autopay,
  onLabelChange,
  onDueDayChange,
  onAutopayChange,
}: {
  label: string;
  dueDay: string;
  autopay: boolean;
  onLabelChange: (v: string) => void;
  onDueDayChange: (v: string) => void;
  onAutopayChange: (v: boolean) => void;
}) {
  return (
    <>
      <input
        className="settings-input"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        placeholder="Bill / account"
      />
      <input
        className="settings-input settings-input-narrow"
        type="number"
        min={1}
        max={31}
        value={dueDay}
        onChange={(e) => onDueDayChange(e.target.value)}
        placeholder="Day due"
      />
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={autopay}
          onChange={(e) => onAutopayChange(e.target.checked)}
        />
        Autopay
      </label>
    </>
  );
}

function isValidDueDay(text: string): boolean {
  const d = Number(text);
  return Number.isInteger(d) && d >= 1 && d <= 31;
}

function EditForm({
  item,
  onSave,
  onCancel,
}: {
  item: BillItem;
  onSave: (label: string, dueDay: number, autopay: boolean) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [dueDay, setDueDay] = useState(String(item.dueDay));
  const [autopay, setAutopay] = useState(item.autopay);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    if (!l || !isValidDueDay(dueDay)) return;
    onSave(l, Number(dueDay), autopay);
  }

  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <BillFields
        label={label}
        dueDay={dueDay}
        autopay={autopay}
        onLabelChange={setLabel}
        onDueDayChange={setDueDay}
        onAutopayChange={setAutopay}
      />
      <div className="settings-array-form-actions">
        <button type="submit" className="settings-array-save" aria-label="Save">
          <IconCheck /> Save
        </button>
        <button type="button" className="settings-array-cancel" onClick={onCancel} aria-label="Cancel">
          <IconX /> Cancel
        </button>
      </div>
    </form>
  );
}

// onBlur-save, same pattern as YnabUnapprovedWidget's MemoCell — no
// debounce needed for a field that's only visible while its row is
// expanded, and it avoids writing on every keystroke.
function BillNoteEditor({
  item,
  onSave,
}: {
  item: BillItem;
  onSave: (note: string) => Promise<void>;
}) {
  const [value, setValue] = useState(item.note ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(item.note ?? ""), [item.note]);

  async function handleBlur() {
    const current = item.note ?? "";
    if (value === current) return;
    setSaving(true);
    await onSave(value);
    setSaving(false);
  }

  return (
    <textarea
      className="bill-note-textarea"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      placeholder="Add a note…"
      disabled={saving}
      rows={2}
    />
  );
}

function BillRow({
  item,
  onSave,
  onSaveNote,
  onDelete,
}: {
  item: BillItem;
  onSave: (label: string, dueDay: number, autopay: boolean) => void;
  onSaveNote: (note: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  if (editing) {
    return (
      <div className="settings-array-row editing">
        <EditForm
          item={item}
          onSave={(label, dueDay, autopay) => {
            onSave(label, dueDay, autopay);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="bill-item">
      <div className="settings-array-row">
        <div className="settings-array-row-main">
          <span className="bill-row-label">{ordinal(item.dueDay)}</span>
          <span className="bill-row-sub">{item.label}</span>
        </div>
        <span className={`pip ${item.autopay ? "live" : ""}`}></span>
        <span className="tag">{item.autopay ? "Autopay" : "Manual"}</span>
        <button
          className={`desc-toggle ${item.note ? "has-note" : ""}`}
          onClick={() => setNoteOpen((v) => !v)}
          title={noteOpen ? "Hide note" : "Show note"}
        >
          <IconNote />
        </button>
        <span className="row-actions">
          <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
            <IconPencil />
          </button>
          <button className="row-action danger" onClick={onDelete} aria-label="Delete">
            <IconTrash />
          </button>
        </span>
      </div>
      {noteOpen && (
        <div className="bill-expand">
          <BillNoteEditor item={item} onSave={onSaveNote} />
        </div>
      )}
    </div>
  );
}

function AddForm({ onAdd }: { onAdd: (label: string, dueDay: number, autopay: boolean) => void }) {
  const [label, setLabel] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [autopay, setAutopay] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    if (!l || !isValidDueDay(dueDay)) return;
    onAdd(l, Number(dueDay), autopay);
    setLabel("");
    setDueDay("");
    setAutopay(false);
  }

  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <BillFields
        label={label}
        dueDay={dueDay}
        autopay={autopay}
        onLabelChange={setLabel}
        onDueDayChange={setDueDay}
        onAutopayChange={setAutopay}
      />
      <button type="submit" disabled={!label.trim() || !isValidDueDay(dueDay)} aria-label="Add">
        <IconPlus />
      </button>
    </form>
  );
}

function BillsBody({ bills, onChange }: Pick<BillsWidgetProps, "bills" | "onChange">) {
  async function handleAdd(label: string, dueDay: number, autopay: boolean) {
    onChange(await window.api.bills.add(label, dueDay, autopay));
  }
  async function handleSave(id: number, label: string, dueDay: number, autopay: boolean) {
    onChange(await window.api.bills.update(id, label, dueDay, autopay));
  }
  async function handleDelete(id: number) {
    onChange(await window.api.bills.remove(id));
  }
  async function handleSaveNote(id: number, note: string) {
    onChange(await window.api.bills.setNote(id, note));
  }

  return (
    <>
      {bills.length === 0 ? (
        <p className="muted">No bills added yet.</p>
      ) : (
        bills.map((item) => (
          <BillRow
            key={item.id}
            item={item}
            onSave={(label, dueDay, autopay) => handleSave(item.id, label, dueDay, autopay)}
            onSaveNote={(note) => handleSaveNote(item.id, note)}
            onDelete={() => handleDelete(item.id)}
          />
        ))
      )}
      <AddForm onAdd={handleAdd} />
    </>
  );
}

function isValidPositiveNumber(text: string): boolean {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n >= 0;
}

// APR above this is colored red (--alert), at or below is green (--live) —
// a plain "is this card expensive to carry a balance on" signal, not tied
// to any particular issuer's rate tiers.
const HIGH_APR_THRESHOLD = 7;

// Utilization above this is colored red (--alert), same "carry too much of a
// balance" signal as HIGH_APR_THRESHOLD, not a credit-score-modeling figure.
const UTILIZATION_WARN_THRESHOLD = 30;
// Amber band just under the warning line, so a card creeping toward it shows
// before it crosses.
const UTILIZATION_NEAR_THRESHOLD = 20;

function utilizationTone(pct: number): "ok" | "near" | "over" {
  if (pct > UTILIZATION_WARN_THRESHOLD) return "over";
  if (pct >= UTILIZATION_NEAR_THRESHOLD) return "near";
  return "ok";
}

// A card contributes only when it's linked to a live YNAB account and has a
// limit to divide by. A YNAB credit-card balance is negative when money is
// owed; a positive one (overpaid) is a credit, not debt, so it counts as zero.
function cardUsage(
  item: CardItem,
  accounts: YnabAccount[]
): { owed: number; pct: number } | null {
  if (!item.ynabAccountId || item.creditLimit <= 0) return null;
  const account = accounts.find((a) => a.id === item.ynabAccountId);
  if (!account) return null;
  const owed = Math.max(0, -account.balance);
  return { owed, pct: (owed / item.creditLimit) * 100 };
}

function UtilizationBar({ owed, limit, pct }: { owed: number; limit: number; pct: number }) {
  return (
    <span
      className="budget-spent"
      title={`${formatCurrency(owed)} of ${formatCurrency(limit)} limit`}
    >
      <span className="budget-spent-track">
        <span
          className={`budget-spent-fill ${utilizationTone(pct)}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
      <span className="budget-spent-pct">{Math.round(pct)}%</span>
    </span>
  );
}

function CardFields({
  name,
  creditLimit,
  apr,
  ynabAccountId,
  ynabAccountOptions,
  onNameChange,
  onCreditLimitChange,
  onAprChange,
  onYnabAccountIdChange,
  onKeyDown,
}: {
  name: string;
  creditLimit: string;
  apr: string;
  ynabAccountId: string;
  ynabAccountOptions: YnabAccount[];
  onNameChange: (v: string) => void;
  onCreditLimitChange: (v: string) => void;
  onAprChange: (v: string) => void;
  onYnabAccountIdChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <td className="card-col-name">
        <input
          className="settings-input card-table-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Card name"
          autoFocus
        />
      </td>
      <td className="card-col-limit">
        <input
          className="settings-input card-table-input"
          type="number"
          min={0}
          step="1"
          value={creditLimit}
          onChange={(e) => onCreditLimitChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Credit limit"
        />
      </td>
      <td className="card-col-apr">
        <input
          className="settings-input card-table-input"
          type="number"
          min={0}
          step="0.01"
          value={apr}
          onChange={(e) => onAprChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="APR %"
        />
      </td>
      <td className="card-col-balance">
        <Select
          className="card-table-input"
          value={ynabAccountId}
          onChange={onYnabAccountIdChange}
          options={[
            { value: "", label: "Not linked" },
            ...ynabAccountOptions.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
      </td>
    </>
  );
}

function CardEditRow({
  item,
  ynabAccountOptions,
  onSave,
  onCancel,
}: {
  item: CardItem;
  ynabAccountOptions: YnabAccount[];
  onSave: (name: string, creditLimit: number, apr: number, ynabAccountId: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [creditLimit, setCreditLimit] = useState(String(item.creditLimit));
  const [apr, setApr] = useState(String(item.apr));
  const [ynabAccountId, setYnabAccountId] = useState(item.ynabAccountId ?? "");

  const valid = name.trim() !== "" && isValidPositiveNumber(creditLimit) && isValidPositiveNumber(apr);

  function handleSave() {
    if (!valid) return;
    onSave(name.trim(), Number(creditLimit), Number(apr), ynabAccountId || null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <tr className="card-row-editing">
      <CardFields
        name={name}
        creditLimit={creditLimit}
        apr={apr}
        ynabAccountId={ynabAccountId}
        ynabAccountOptions={ynabAccountOptions}
        onNameChange={setName}
        onCreditLimitChange={setCreditLimit}
        onAprChange={setApr}
        onYnabAccountIdChange={setYnabAccountId}
        onKeyDown={handleKeyDown}
      />
      <td className="card-col-actions">
        <span className="row-actions always-visible">
          <button className="row-action" onClick={handleSave} disabled={!valid} aria-label="Save">
            <IconCheck />
          </button>
          <button className="row-action" onClick={onCancel} aria-label="Cancel">
            <IconX />
          </button>
        </span>
      </td>
    </tr>
  );
}

function CardRow({
  item,
  ynabAccountOptions,
  onSave,
  onDelete,
}: {
  item: CardItem;
  ynabAccountOptions: YnabAccount[];
  onSave: (name: string, creditLimit: number, apr: number, ynabAccountId: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CardEditRow
        item={item}
        ynabAccountOptions={ynabAccountOptions}
        onSave={(name, creditLimit, apr, ynabAccountId) => {
          onSave(name, creditLimit, apr, ynabAccountId);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // A stale link (account closed upstream, or the YNAB fetch failed) fails
  // soft rather than throwing on an undefined lookup.
  const linkedAccount = item.ynabAccountId
    ? ynabAccountOptions.find((a) => a.id === item.ynabAccountId)
    : undefined;

  let balanceCell: ReactNode;
  if (!item.ynabAccountId) {
    balanceCell = <span className="muted">—</span>;
  } else if (!linkedAccount) {
    balanceCell = <span className="muted">Link unavailable</span>;
  } else if (item.creditLimit <= 0) {
    balanceCell = <span className="muted">No limit set</span>;
  } else {
    const usage = cardUsage(item, ynabAccountOptions);
    balanceCell = usage ? (
      <UtilizationBar owed={usage.owed} limit={item.creditLimit} pct={usage.pct} />
    ) : (
      <span className="muted">—</span>
    );
  }

  return (
    <tr>
      <td className="card-col-name">{item.name}</td>
      <td className="card-col-limit">{formatCurrency(item.creditLimit)}</td>
      <td className={`card-col-apr ${item.apr > HIGH_APR_THRESHOLD ? "apr-high" : "apr-low"}`}>
        {formatApr(item.apr)}
      </td>
      <td className="card-col-balance">{balanceCell}</td>
      <td className="card-col-actions">
        <span className="row-actions">
          <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
            <IconPencil />
          </button>
          <button className="row-action danger" onClick={onDelete} aria-label="Delete">
            <IconTrash />
          </button>
        </span>
      </td>
    </tr>
  );
}

function CardAddRow({
  ynabAccountOptions,
  onAdd,
}: {
  ynabAccountOptions: YnabAccount[];
  onAdd: (name: string, creditLimit: number, apr: number, ynabAccountId: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [apr, setApr] = useState("");
  const [ynabAccountId, setYnabAccountId] = useState("");

  const valid = name.trim() !== "" && isValidPositiveNumber(creditLimit) && isValidPositiveNumber(apr);

  function handleAdd() {
    if (!valid) return;
    onAdd(name.trim(), Number(creditLimit), Number(apr), ynabAccountId || null);
    setName("");
    setCreditLimit("");
    setApr("");
    setYnabAccountId("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <tr className="card-row-editing">
      <CardFields
        name={name}
        creditLimit={creditLimit}
        apr={apr}
        ynabAccountId={ynabAccountId}
        ynabAccountOptions={ynabAccountOptions}
        onNameChange={setName}
        onCreditLimitChange={setCreditLimit}
        onAprChange={setApr}
        onYnabAccountIdChange={setYnabAccountId}
        onKeyDown={handleKeyDown}
      />
      <td className="card-col-actions">
        <button className="row-action always-visible" onClick={handleAdd} disabled={!valid} aria-label="Add">
          <IconPlus />
        </button>
      </td>
    </tr>
  );
}

function CardsBody({
  cards,
  onCardsChange,
  ynabAccounts,
}: {
  cards: CardItem[];
  onCardsChange: (cards: CardItem[]) => void;
  ynabAccounts: YnabAccountsResult | null;
}) {
  const ynabAccountOptions = ynabAccounts?.ok ? ynabAccounts.accounts : [];

  async function handleAdd(
    name: string,
    creditLimit: number,
    apr: number,
    ynabAccountId: string | null
  ) {
    onCardsChange(await window.api.cards.add(name, creditLimit, apr, ynabAccountId));
  }
  async function handleSave(
    id: number,
    name: string,
    creditLimit: number,
    apr: number,
    ynabAccountId: string | null
  ) {
    onCardsChange(await window.api.cards.update(id, name, creditLimit, apr, ynabAccountId));
  }
  async function handleDelete(id: number) {
    onCardsChange(await window.api.cards.remove(id));
  }

  return (
    <table className="ynab-table cards-table">
      <thead>
        <tr>
          <th className="card-col-name">Name</th>
          <th className="card-col-limit">Limit</th>
          <th className="card-col-apr">APR</th>
          <th className="card-col-balance">Utilization</th>
          <th className="card-col-actions" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {cards.length === 0 && (
          <tr>
            <td colSpan={5} className="muted">
              No cards added yet.
            </td>
          </tr>
        )}
        {cards.map((item) => (
          <CardRow
            key={item.id}
            item={item}
            ynabAccountOptions={ynabAccountOptions}
            onSave={(name, creditLimit, apr, ynabAccountId) =>
              handleSave(item.id, name, creditLimit, apr, ynabAccountId)
            }
            onDelete={() => handleDelete(item.id)}
          />
        ))}
        <CardAddRow ynabAccountOptions={ynabAccountOptions} onAdd={handleAdd} />
      </tbody>
    </table>
  );
}

const SEGMENT_COUNT = 5;

// Overall utilization across every linked card: total owed over total limit,
// drawn as one bar split into a segment per card (so you can see which card is
// the weight), with the 30% line marked. Cards that aren't linked to a YNAB
// account, or have no limit, can't contribute and are counted but left out.
const TREND_VIEW_WIDTH = 320;
const TREND_VIEW_HEIGHT = 110;
const TREND_PAD = 8;

function monthLabel(month: string): string {
  return new Date(month + "T12:00:00").toLocaleDateString("en-US", { month: "short" });
}

// Overall utilization at each month-end: what was owed across the counted cards
// over their combined limit. Uses today's limits for every month — a limit
// raised last spring would otherwise make older months look worse than they
// were, but YNAB has no record of past limits to use instead.
function UtilizationTrend({ months, values }: { months: string[]; values: number[] }) {
  const yMax = Math.max(40, Math.ceil(Math.max(...values) / 10) * 10);
  const stepX = (TREND_VIEW_WIDTH - TREND_PAD * 2) / Math.max(1, values.length - 1);
  const x = (i: number) => TREND_PAD + i * stepX;
  const y = (v: number) => TREND_PAD + (1 - v / yMax) * (TREND_VIEW_HEIGHT - TREND_PAD * 2);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;

  return (
    <div className="util-trend">
      <div className="util-trend-head">
        <span className="util-trend-title">Last {values.length} months</span>
        <span className="muted">
          {Math.abs(change) < 0.5 ? "about the same as" : `${change > 0 ? "up" : "down"} ${Math.abs(Math.round(change))} points from`}{" "}
          {monthLabel(months[0])}
        </span>
      </div>
      <svg
        className="util-trend-chart"
        viewBox={`0 0 ${TREND_VIEW_WIDTH} ${TREND_VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Overall credit utilization by month"
      >
        <line
          className="util-trend-threshold"
          x1={TREND_PAD}
          x2={TREND_VIEW_WIDTH - TREND_PAD}
          y1={y(UTILIZATION_WARN_THRESHOLD)}
          y2={y(UTILIZATION_WARN_THRESHOLD)}
          vectorEffect="non-scaling-stroke"
        />
        <path className="util-trend-line" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="util-trend-axis">
        <span>{monthLabel(months[0])}</span>
        <span>{UTILIZATION_WARN_THRESHOLD}% line dashed</span>
        <span>{monthLabel(months[months.length - 1])}</span>
      </div>
      <ul className="util-trend-values">
        {values.map((v, i) => (
          <li key={months[i]} className={utilizationTone(v)} title={`${monthLabel(months[i])}: ${v.toFixed(1)}%`}>
            <span>{Math.round(v)}%</span>
            <span>{monthLabel(months[i])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UtilizationBody({
  cards,
  ynabAccounts,
}: {
  cards: CardItem[];
  ynabAccounts: YnabAccountsResult | null;
}) {
  const accounts = ynabAccounts?.ok ? ynabAccounts.accounts : [];
  const counted = cards
    .map((card) => ({ card, usage: cardUsage(card, accounts) }))
    .filter((c): c is { card: CardItem; usage: { owed: number; pct: number } } => c.usage !== null);
  const skipped = cards.length - counted.length;

  // History is keyed on which accounts are counted, not on balances, so a
  // balance ticking over on the 5-minute poll doesn't refetch it.
  const accountKey = counted.map((c) => c.card.ynabAccountId).join(",");
  const [history, setHistory] = useState<YnabAccountHistoryResult | null>(null);
  useEffect(() => {
    if (!accountKey) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    window.api.ynab.accountHistory(accountKey.split(",")).then((res) => {
      if (!cancelled) setHistory(res);
    });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  const series = useMemo(() => {
    if (!history?.ok || history.months.length === 0) return null;
    const present = counted.filter((c) => history.balances[c.card.ynabAccountId as string]);
    const limit = present.reduce((sum, c) => sum + c.card.creditLimit, 0);
    if (present.length === 0 || limit <= 0) return null;
    return history.months.map((_, i) => {
      const owed = present.reduce(
        (sum, c) => sum + Math.max(0, -history.balances[c.card.ynabAccountId as string][i]),
        0
      );
      return (owed / limit) * 100;
    });
    // `counted` is rebuilt every render; its identity is carried by accountKey
    // plus the limits, which can't change without the cards prop doing so.
  }, [history, cards, accountKey]);

  if (ynabAccounts && !ynabAccounts.ok) {
    return <p className="muted">{ynabAccounts.reason}</p>;
  }
  if (counted.length === 0) {
    return (
      <p className="muted">
        Link a card to a YNAB account (and give it a limit) on the Cards tab to see utilization.
      </p>
    );
  }

  const totalOwed = counted.reduce((sum, c) => sum + c.usage.owed, 0);
  const totalLimit = counted.reduce((sum, c) => sum + c.card.creditLimit, 0);
  const overall = (totalOwed / totalLimit) * 100;
  const tone = utilizationTone(overall);
  const underTarget = (totalLimit * UTILIZATION_WARN_THRESHOLD) / 100;
  const payDown = Math.max(0, totalOwed - underTarget);
  // Segments are widths of the *limit*, so the filled part of the bar is the
  // utilization itself and the threshold marker sits at a true 30%.
  const ordered = counted.slice().sort((a, b) => b.usage.owed - a.usage.owed);

  return (
    <div className="util">
      <div className="util-headline">
        <span className={`util-pct ${tone}`}>{overall.toFixed(overall < 10 ? 1 : 0)}%</span>
        <span className="muted">
          {formatCurrency(totalOwed)} of {formatCurrency(totalLimit)} across {counted.length}{" "}
          {counted.length === 1 ? "card" : "cards"}
        </span>
      </div>
      <div className="util-track" role="img" aria-label={`Overall utilization ${Math.round(overall)}%`}>
        {ordered.map((c, i) => (
          <span
            key={c.card.id}
            className={`util-segment seg-${i % SEGMENT_COUNT}`}
            style={{ width: `${(c.usage.owed / totalLimit) * 100}%` }}
            title={`${c.card.name}: ${formatCurrency(c.usage.owed)}`}
          />
        ))}
        <span className="util-marker" style={{ left: `${UTILIZATION_WARN_THRESHOLD}%` }} />
      </div>
      <div className="util-scale">
        <span>0%</span>
        <span style={{ left: `${UTILIZATION_WARN_THRESHOLD}%` }} className="util-scale-mark">
          {UTILIZATION_WARN_THRESHOLD}%
        </span>
        <span>100%</span>
      </div>
      <ul className="util-legend">
        {ordered.map((c, i) => (
          <li key={c.card.id}>
            <span className={`util-swatch seg-${i % SEGMENT_COUNT}`} />
            <span className="util-legend-name">{c.card.name}</span>
            <span className="util-legend-value">
              {formatCurrency(c.usage.owed)} · {Math.round(c.usage.pct)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="muted util-note">
        {payDown > 0
          ? `Paying down ${formatCurrency(payDown)} would bring you under ${UTILIZATION_WARN_THRESHOLD}%.`
          : `Under the ${UTILIZATION_WARN_THRESHOLD}% line.`}
        {skipped > 0 &&
          ` ${skipped} ${skipped === 1 ? "card isn't" : "cards aren't"} linked to a YNAB account or ${skipped === 1 ? "has" : "have"} no limit, so ${skipped === 1 ? "it's" : "they're"} not counted.`}
      </p>
      {history && !history.ok && <p className="muted util-note">Trend unavailable: {history.reason}</p>}
      {series && history?.ok && <UtilizationTrend months={history.months} values={series} />}
      {series && (
        <p className="muted util-note">
          Worked back from each card's transactions and measured against today's limits, so it's
          month-end balance rather than statement balance.
        </p>
      )}
    </div>
  );
}

export default function BillsWidget({
  bills,
  onChange,
  cards,
  onCardsChange,
  ynabAccounts,
}: BillsWidgetProps) {
  const [tab, setTab] = useState<Tab>("bills");

  const headerRight = (
    <div className="scratchpad-toolbar">
      <div className="scratchpad-modes">
        <button
          type="button"
          className={`scratchpad-mode ${tab === "bills" ? "active" : ""}`}
          onClick={() => setTab("bills")}
        >
          Bills
        </button>
        <button
          type="button"
          className={`scratchpad-mode ${tab === "cards" ? "active" : ""}`}
          onClick={() => setTab("cards")}
        >
          Cards
        </button>
        <button
          type="button"
          className={`scratchpad-mode ${tab === "utilization" ? "active" : ""}`}
          onClick={() => setTab("utilization")}
        >
          Utilization
        </button>
      </div>
    </div>
  );

  return (
    <Panel
      title={tab === "bills" ? "Bills" : tab === "cards" ? "Cards" : "Credit Utilization"}
      headerRight={headerRight}
    >
      {tab === "bills" ? (
        <BillsBody bills={bills} onChange={onChange} />
      ) : tab === "cards" ? (
        <CardsBody cards={cards} onCardsChange={onCardsChange} ynabAccounts={ynabAccounts} />
      ) : (
        <UtilizationBody cards={cards} ynabAccounts={ynabAccounts} />
      )}
    </Panel>
  );
}
